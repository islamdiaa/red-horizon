/**
 * Challenge modes: Survival (three climate variants) and the Daily Challenge.
 * Everything here runs inside the deterministic simulation tick: use m.world.rng, never Math.random.
 * Script state lives in m.flags and stays JSON-serialisable (ids, numbers, strings) for save games.
 */
import { BUILDINGS, UNITS, type Faction } from '../data/rules';
import type { MissionDef, MissionRuntime } from '../sim/mission';
import type { Unit } from '../sim/entities';
import type { Player } from '../sim/player'; // co-op survival
import { AI_DIFFICULTIES, type AIDifficulty } from '../sim/ai';
import { DAILY_MODIFIERS, MODIFIER_BY_ID, dailyConfig, dailyVictoryScore, dayKey, type DailyConfig } from '../meta/daily';

// =============================================================================
// Shared helpers (take the runtime; kept local so src/sim/mission.ts stays untouched)
// =============================================================================
type Side = 'n' | 's' | 'e' | 'w';
const SIDES: Side[] = ['n', 's', 'e', 'w'];
const SIDE_NAME: Record<Side, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };

/** Direct orders (bypass the command queue, which ignores players flagged as defeated). */
function orderMove(m: MissionRuntime, units: Unit[], x: number, y: number) {
  units.forEach((u, k) => {
    if (!u.alive) return;
    const a = k * 2.399, r = k ? 0.7 + (k % 5) * 0.45 : 0;
    const [tx, ty] = clampPt(m, x + Math.cos(a) * r, y + Math.sin(a) * r);
    m.world.giveOrder(u, { type: 'move', x: tx, y: ty, attackMove: true });
  });
}
function orderAttack(m: MissionRuntime, units: Unit[], targetId: number) {
  for (const u of units) if (u.alive && u.weapons.length) m.world.giveOrder(u, { type: 'attack', target: targetId, forced: false });
}
function clampPt(m: MissionRuntime, x: number, y: number, margin = 1.5): [number, number] {
  return [Math.min(m.mapW - margin, Math.max(margin, x)), Math.min(m.mapH - margin, Math.max(margin, y))];
}
/** Remove a unit without an explosion and without counting it as lost (aircraft leaving the map). */
function removeQuiet(m: MissionRuntime, u: Unit) {
  if (!u.alive) return;
  m.world.kill(u, 'sold');
  u.owner.stats.unitsLost = Math.max(0, u.owner.stats.unitsLost - 1);
}
/** Centre of a defender's base, the human's by default (construction yard, else the building centroid, else the start). */
function baseCentre(m: MissionRuntime, p = 0): [number, number] {
  const bs = m.buildings(p);
  const fact = bs.find((b) => b.bt.id === 'fact');
  if (fact) return [fact.x, fact.y];
  const real = bs.filter((b) => !b.bt.wall);
  if (real.length) return [real.reduce((s, b) => s + b.x, 0) / real.length, real.reduce((s, b) => s + b.y, 0) / real.length];
  const us = m.units(p);
  if (us.length) return [us[0].x, us[0].y];
  const s = m.start(p);
  return [s.x, s.y];
}
/** The human and any AI teammates (co-op survival); never the horde (player 1). */
function isDefender(m: MissionRuntime, p: Player): boolean {
  return p.team === m.human.team && p !== m.player(1);
}
/** Nearest living target of the defenders (non-wall structure preferred) to a point. */
function nearestHumanTarget(m: MissionRuntime, x: number, y: number, preferTypes?: string[]): { id: number; x: number; y: number } | null {
  let best: { id: number; x: number; y: number } | null = null, bd = Infinity;
  const consider = (id: number, ex: number, ey: number, bonus: number) => {
    const d = Math.hypot(ex - x, ey - y) - bonus;
    if (d < bd) { bd = d; best = { id, x: ex, y: ey }; }
  };
  for (const b of m.world.buildings) {
    if (!b.alive || !isDefender(m, b.owner) || b.bt.wall) continue;
    consider(b.id, b.x, b.y, preferTypes?.includes(b.bt.id) ? 25 : 0);
  }
  if (!best) for (const u of m.world.units) if (u.alive && isDefender(m, u.owner)) consider(u.id, u.x, u.y, 0);
  return best;
}
/** Map point `d` cells in from an edge, `along` cells along it. */
function edgeCell(m: MissionRuntime, side: Side, along: number, d: number): [number, number] {
  const horizontal = side === 'n' || side === 's';
  const x = horizontal ? along : side === 'w' ? d : m.mapW - d;
  const y = horizontal ? (side === 'n' ? d : m.mapH - d) : along;
  return [x, y];
}
/**
 * An entry point near the given edge position from which ground forces can actually reach the
 * human base (edges are often forest or cliff pockets). Falls back to the original point.
 */
function entryPoint(m: MissionRuntime, side: Side, along: number, bx: number, by: number): [number, number] {
  const map = m.world.map;
  const len = side === 'n' || side === 's' ? m.mapW : m.mapH;
  for (const shift of [0, 7, -7, 14, -14, 22, -22, 30, -30]) {
    const a = Math.min(len - 3, Math.max(3, along + shift));
    for (let d = 1.5; d <= 16; d += 1) {
      const [x, y] = edgeCell(m, side, a, d);
      const cx = Math.floor(x), cy = Math.floor(y);
      if (!map.passable(cx, cy)) continue;
      const path = m.world.pathfinder.find(cx, cy, Math.floor(bx), Math.floor(by), 7000);
      const last = path?.[path.length - 1];
      if (last && Math.hypot(last.x - bx, last.y - by) < 9) return [x, y];
      break; // this lane is cut off; try another stretch of the edge
    }
  }
  return edgeCell(m, side, Math.min(len - 3, Math.max(3, along)), 2.5);
}
/** Spawn a group at a reachable entry point on a map edge, spread in a few ranks. Aircraft appear right at the edge. */
function spawnAtEdge(m: MissionRuntime, p: number, types: string[], side: Side, along: number, rank = 0, target?: [number, number]): Unit[] {
  const out: Unit[] = [];
  if (!types.length) return out;
  const horizontal = side === 'n' || side === 's';
  const inward = side === 'n' || side === 'w' ? 1 : -1;
  const heading = horizontal ? (inward > 0 ? Math.PI / 2 : -Math.PI / 2) : inward > 0 ? 0 : Math.PI;
  const [bx, by] = target ?? baseCentre(m); // co-op: the base this wave goes for
  const ground = types.some((t) => UNITS[t].kind !== 'aircraft');
  const [ax, ay] = ground ? entryPoint(m, side, along, bx, by) : edgeCell(m, side, along, 1);
  const [ix, iy] = horizontal ? [0, inward] : [inward, 0];
  const [lx, ly] = horizontal ? [1, 0] : [0, 1];
  let gk = 0, ak = 0;
  for (const t of types) {
    const air = UNITS[t].kind === 'aircraft';
    const k = air ? ak++ : gk++;
    const lane = (k % 7) - 3, depth = Math.floor(k / 7);
    let x: number, y: number;
    if (air) [x, y] = edgeCell(m, side, Math.min((horizontal ? m.mapW : m.mapH) - 2, Math.max(2, along + lane * 1.6)), 1 + depth * 0.8);
    else [x, y] = clampPt(m, ax + lx * lane * 1.1 + ix * depth * 1.1, ay + ly * lane * 1.1 + iy * depth * 1.1, 1);
    const u = m.spawnUnit(p, t, x, y, heading);
    if (rank > 0 && !air) u.rank = Math.min(2, rank);
    out.push(u);
  }
  return out;
}
function pickSide(m: MissionRuntime, avoid?: Side): Side {
  let s = SIDES[m.world.rng.int(0, 3)];
  if (s === avoid) s = SIDES[(SIDES.indexOf(s) + 1 + m.world.rng.int(0, 2)) % 4];
  return s;
}
function alongFor(m: MissionRuntime, side: Side): number {
  const len = side === 'n' || side === 's' ? m.mapW : m.mapH;
  return m.world.rng.range(10, len - 10);
}
/** Drop bonus crates near a point (collected by the first unit that drives over them). */
function dropCrates(m: MissionRuntime, x: number, y: number, n: number) {
  const map = m.world.map;
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 30; tries++) {
      const a = m.world.rng.range(0, Math.PI * 2), r = m.world.rng.range(4, 9);
      const cx = Math.floor(x + Math.cos(a) * r), cy = Math.floor(y + Math.sin(a) * r);
      if (!map.inBounds(cx, cy) || !map.passable(cx, cy) || map.occupant[map.idx(cx, cy)]) continue;
      m.flags.crateSeq = (m.flags.crateSeq ?? 0) + 1;
      m.world.crates.push({ id: 6_000_000 + m.flags.crateSeq, x: cx + 0.5, y: cy + 0.5 });
      break;
    }
  }
}
function fill(m: MissionRuntime, pool: string[], budget: number, out: string[], cap: number) {
  let spent = 0, guard = 0;
  while (spent < budget && out.length < cap && guard++ < 200) {
    const t = m.world.rng.pick(pool);
    out.push(t);
    spent += UNITS[t].cost;
  }
}
const repeat = (t: string, n: number) => Array.from({ length: Math.max(0, n) }, () => t);

// =============================================================================
// SURVIVAL
// =============================================================================
interface HordePools {
  inf: string[];
  armour: string[];
  air: string[];
  bossA: { name: string; build: (n: number) => string[] };
  bossB: { name: string; build: (n: number) => string[] };
  /** Targets air raids go for first. */
  airTargets: string[];
}
const HORDES: Record<Faction, HordePools> = {
  soviet: {
    inf: ['e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e4', 'dog'],
    armour: ['3tnk', '3tnk', '3tnk', 'v2rl'],
    air: ['yak', 'yak', 'mig', 'mig', 'hind'],
    bossA: { name: 'Mammoth column', build: (n) => [...repeat('4tnk', 2 + Math.floor(n / 10)), ...repeat('3tnk', 2 + Math.floor(n / 5)), 'e3', 'e3', 'e3'] },
    bossB: { name: 'V2 rocket battery', build: (n) => [...repeat('v2rl', 3 + Math.floor(n / 10)), ...repeat('3tnk', 2 + Math.floor(n / 8)), ...repeat('4tnk', Math.floor(n / 20)), 'e1', 'e1', 'e1', 'e1'] },
    airTargets: ['proc', 'powr', 'apwr', 'tsla', 'gun', 'sam', 'agun'],
  },
  allies: {
    inf: ['e1', 'e1', 'e1', 'e3', 'e3', 'medi'],
    armour: ['1tnk', '2tnk', '2tnk', 'jeep', 'apc', 'arty'],
    air: ['heli'],
    bossA: { name: 'artillery battery', build: (n) => [...repeat('arty', 4 + Math.floor(n / 10)), ...repeat('2tnk', 2 + Math.floor(n / 8)), 'e3', 'e3', 'e3'] },
    bossB: { name: 'armoured spearhead', build: (n) => [...repeat('2tnk', 5 + Math.floor(n / 6)), 'e7', 'medi', 'medi', ...repeat('heli', Math.floor(n / 10))] },
    airTargets: ['proc', 'powr', 'apwr', 'tsla', 'ftur', 'sam', 'agun'],
  },
};

type WaveKind = 'swarm' | 'armour' | 'combined' | 'pincer' | 'air' | 'boss';

export interface SurvivalVariant {
  id: string;
  index: number;
  title: string;
  codename: string;
  location: string;
  climate: 'temperate' | 'winter' | 'desert';
  /** Difficulty / score factor: wave budgets and points are multiplied by it. */
  factor: number;
  hour: number;
  seed: number;
  size: number;
  water: number;
  trees: number;
  ore: number;
  human: Faction;
  horde: Faction;
  hordeName: string;
  blurb: string;
}

export const SURVIVAL_VARIANTS: SurvivalVariant[] = [
  { id: 'survival', index: 1, title: 'Last Stand', codename: 'LAST STAND', location: 'Rhine Valley', climate: 'temperate', factor: 1, hour: 15, seed: 4242, size: 72, water: 0.3, trees: 0.6, ore: 0.9,
    human: 'allies', horde: 'soviet', hordeName: 'The Red Horde', blurb: 'Green hills, a river crossing and an endless Soviet tide.' },
  { id: 'survival-winter', index: 2, title: 'Frozen Front', codename: 'FROZEN FRONT', location: 'Carpathian Pass', climate: 'winter', factor: 1.15, hour: 9.5, seed: 7171, size: 72, water: 0.35, trees: 0.7, ore: 0.85,
    human: 'soviet', horde: 'allies', hordeName: 'Allied Expeditionary Force', blurb: 'Hold the frozen pass against Allied armour and Longbow strikes.' },
  { id: 'survival-desert', index: 3, title: 'Burning Sands', codename: 'BURNING SANDS', location: 'Sinai Peninsula', climate: 'desert', factor: 1.3, hour: 12.5, seed: 9393, size: 76, water: 0.15, trees: 0.4, ore: 0.75,
    human: 'allies', horde: 'soviet', hordeName: 'Desert Legion', blurb: 'Open sand, scarce ore and nowhere to hide from the MiGs.' },
];

const COLOR: Record<Faction, number> = { allies: 0x3d7be0, soviet: 0xd23a2c };

function survivalBudget(n: number, factor: number): number {
  return (800 + 360 * n + 26 * n * n) * factor;
}

// ---- co-op survival: AI teammates with their own bases; waves go for every base in turn ----
/** Score factor (difficulty x co-op discount). */
function scoreFactor(m: MissionRuntime, v: SurvivalVariant): number {
  return v.factor * (m.flags.coopScore ?? 1);
}
/** Structures lost by the whole defending team (solo: the human's). */
function teamBuildingsLost(m: MissionRuntime): number {
  let n = 0;
  for (const p of m.world.players) if (isDefender(m, p)) n += p.stats.buildingsLost;
  return n;
}
/** Defender whose base wave n goes for: the human solo; in co-op every standing base in turn. */
function waveTarget(m: MissionRuntime, n: number): number {
  const ds = m.world.players.filter((p) => isDefender(m, p) && !p.defeated && (m.buildings(p).length > 0 || m.units(p).length > 0));
  if (ds.length <= 1) return ds[0]?.id ?? 0;
  return ds[(n - 1) % ds.length].id;
}
/** Allied AIs send part of their idle army when the human's base is under heavy attack. */
function allyHelp(m: MissionRuntime) {
  const horde = m.player(1);
  const [hx, hy] = baseCentre(m, 0);
  let value = 0, sx = 0, sy = 0, k = 0;
  for (const u of m.world.units) {
    if (!u.alive || u.owner !== horde || u.kind === 'aircraft' || Math.hypot(u.x - hx, u.y - hy) > 18) continue;
    value += u.ut.cost; sx += u.x; sy += u.y; k++;
  }
  if (value < 1500 || !k) return;
  for (const p of m.world.players) {
    if (!isDefender(m, p) || p === m.human || p.defeated) continue;
    const [ax, ay] = baseCentre(m, p.id);
    let home = 0;
    for (const u of m.world.units) if (u.alive && u.owner === horde && Math.hypot(u.x - ax, u.y - ay) < 16) home++;
    if (home > 2) continue;
    const idle = m.army(p.id, false).filter((u) => (u.order.type === 'idle' || u.order.type === 'guard') && !u.target)
      .sort((a, b) => Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy) || a.id - b.id);
    const n = Math.ceil(idle.length * 0.6);
    if (n < 2) continue;
    m.move(idle.slice(0, n), sx / k, sy / k, true);
    if (m.time - (m.flags.helpSaid ?? -1e9) > 90) {
      m.flags.helpSaid = m.time;
      m.say(p.name, 'Hold on, commander. Sending armour to your base!', 'commander');
    }
  }
}

function launchWave(m: MissionRuntime, v: SurvivalVariant) {
  const n = ++m.flags.wave;
  const rng = m.world.rng;
  const pools = HORDES[v.horde];
  if (n > 1) m.flags.survived = n - 1;
  // what kind of wave?
  let kind: WaveKind;
  if (n % 5 === 0) kind = 'boss';
  else if (n >= 3 && n % 5 === 3) kind = 'air';
  else {
    const opts: WaveKind[] = ['swarm', 'combined'];
    if (n >= 2) opts.push('armour');
    if (n >= 6) opts.push('pincer');
    kind = rng.pick(opts);
    if (kind === m.flags.lastKind) kind = rng.pick(opts);
  }
  m.flags.lastKind = kind;
  const budget = survivalBudget(n, v.factor) * (m.flags.budgetMul ?? 1); // co-op: bigger waves
  const rank = n >= 22 ? 2 : n >= 12 ? 1 : 0;
  const cap = 44;
  const tgt = waveTarget(m, n); // co-op: the base this wave goes for (solo: the human's)
  const [bx, by] = baseCentre(m, tgt);
  const at: [number, number] = [bx, by];
  if (m.flags.allies) (m.flags.waveTargets ??= []).push(tgt);
  const side = pickSide(m, m.flags.lastSide);
  m.flags.lastSide = side;
  const along = alongFor(m, side);
  const types: string[] = [];
  let line = '';
  switch (kind) {
    case 'swarm':
      fill(m, pools.inf, budget * 0.85, types, cap);
      fill(m, pools.armour, budget * 0.15, types, cap);
      line = `Wave ${n}: infantry swarm from the ${SIDE_NAME[side]}!`;
      break;
    case 'armour':
      fill(m, pools.armour, budget * 0.85, types, cap);
      fill(m, pools.inf, budget * 0.15, types, cap);
      line = `Wave ${n}: armour column rolling in from the ${SIDE_NAME[side]}!`;
      break;
    case 'combined':
      fill(m, pools.armour, budget * 0.5, types, cap);
      fill(m, pools.inf, budget * 0.5, types, cap);
      line = `Wave ${n}: combined-arms assault from the ${SIDE_NAME[side]}!`;
      break;
    case 'pincer': {
      const a: string[] = [], b: string[] = [];
      fill(m, pools.armour, budget * 0.3, a, cap / 2);
      fill(m, pools.inf, budget * 0.2, a, cap / 2);
      fill(m, pools.armour, budget * 0.3, b, cap / 2);
      fill(m, pools.inf, budget * 0.2, b, cap / 2);
      const side2: Side = side === 'n' ? 's' : side === 's' ? 'n' : side === 'e' ? 'w' : 'e';
      const at2 = baseCentre(m, waveTarget(m, n + 1)); // co-op: the second column goes for the next base
      const ua = spawnAtEdge(m, 1, a, side, along, rank, at);
      const ub = spawnAtEdge(m, 1, b, side2, alongFor(m, side2), rank, at2);
      orderMove(m, ua, bx, by);
      orderMove(m, ub, at2[0], at2[1]);
      m.say('Intelligence', `Wave ${n}: pincer attack! Enemy columns from the ${SIDE_NAME[side]} and the ${SIDE_NAME[side2]}.`, 'intel');
      break;
    }
    case 'air': {
      const planes: string[] = [];
      const nPlanes = Math.min(9, 2 + Math.floor(n / 3));
      for (let k = 0; k < nPlanes; k++) planes.push(rng.pick(pools.air));
      fill(m, pools.inf, budget * 0.25, types, cap);
      const air = spawnAtEdge(m, 1, planes, side, along, 0, at);
      const tgt = nearestHumanTarget(m, bx, by, pools.airTargets);
      if (tgt) orderAttack(m, air, tgt.id);
      m.flags.air = [...(m.flags.air ?? []), ...air.map((u) => u.id)];
      line = `Wave ${n}: AIR RAID! ${nPlanes} aircraft inbound from the ${SIDE_NAME[side]}. Man the anti-air!`;
      break;
    }
    case 'boss': {
      const boss = (n / 5) % 2 === 1 ? pools.bossA : pools.bossB;
      const bt = boss.build(n);
      const air = bt.filter((t) => UNITS[t].kind === 'aircraft');
      const ground = bt.filter((t) => UNITS[t].kind !== 'aircraft');
      fill(m, pools.inf, budget * 0.15, ground, cap + 10);
      const units = spawnAtEdge(m, 1, ground, side, along, Math.min(2, rank + 1), at);
      orderMove(m, units, bx, by);
      const planes = spawnAtEdge(m, 1, air, side, along, 0, at);
      const tgt = nearestHumanTarget(m, bx, by, pools.airTargets);
      if (tgt && planes.length) orderAttack(m, planes, tgt.id);
      m.flags.air = [...(m.flags.air ?? []), ...planes.map((u) => u.id)];
      m.flags.boss = { n, ids: [...units, ...planes].map((u) => u.id) };
      m.say('Intelligence', `BOSS WAVE ${n}: ${/^[aeiou]/i.test(boss.name) ? 'an' : 'a'} ${boss.name} is coming from the ${SIDE_NAME[side]}! Destroy it for a supply drop.`, 'intel');
      m.announce('base_under_attack');
      break;
    }
  }
  if (types.length) {
    const units = spawnAtEdge(m, 1, types, side, along, rank, at);
    orderMove(m, units, bx, by);
  }
  if (line && tgt !== 0) line = kind === 'air' ? `${line} Target: ${m.player(tgt).name}'s base.` : line.replace(/!$/, `, heading for ${m.player(tgt).name}'s base!`); // co-op
  if (line) m.say('Intelligence', line, 'intel');
  m.flags.waveActive = true;
  m.flags.waveLossMark = teamBuildingsLost(m);
  if (n > 1) m.addScore('Score', Math.round(100 * (n - 1) * m.flags.mult * scoreFactor(m, v)));
  m.progress('survive', `Wave ${n} · x${m.flags.mult.toFixed(2)}`);
  if (m.flags.survived >= 10) m.complete('ten');
  else m.progress('ten', `${m.flags.survived} / 10`);
  const gap = Math.max(38, 78 - n * 1.6) + (kind === 'boss' ? 20 : 0);
  m.startTimer('wave', gap, `Wave ${n + 1}`);
}

function survivalUpdate(m: MissionRuntime, v: SurvivalVariant) {
  if (m.timerDone('wave')) launchWave(m, v);
  const horde = m.player(1);

  // score: kills (later waves are worth more), multiplier resets when a structure falls
  if (m.every(1, 'score')) {
    const n = Math.max(1, m.flags.wave);
    const lost = horde.stats.unitsLost;
    const d = lost - m.flags.hordeLost;
    if (d > 0) {
      m.flags.hordeLost = lost;
      m.addScore('Score', Math.round(d * (10 + 2 * n) * m.flags.mult * scoreFactor(m, v)));
    }
    const bl = teamBuildingsLost(m); // co-op: any defender's structure
    if (bl > m.flags.humanBLost) {
      m.flags.humanBLost = bl;
      if (m.flags.mult > 1) {
        m.flags.mult = 1;
        m.say('Logistics', 'Structure lost: score multiplier reset to x1.00.', 'commander');
        m.progress('survive', `Wave ${m.flags.wave} · x1.00`);
      }
    }
    // wave cleared?
    if (m.flags.waveActive && m.flags.wave > 0) {
      let alive = 0;
      for (const u of m.world.units) if (u.alive && u.owner === horde) { alive++; break; }
      if (!alive) {
        m.flags.waveActive = false;
        const cleanWave = teamBuildingsLost(m) === m.flags.waveLossMark;
        if (cleanWave) m.flags.mult = Math.min(5, m.flags.mult + 0.25);
        m.addScore('Score', Math.round(150 * n * m.flags.mult * scoreFactor(m, v)));
        m.give(0, 200 + 30 * n);
        m.say('Intelligence', `Wave ${n} repelled.${cleanWave ? ` Multiplier x${m.flags.mult.toFixed(2)}.` : ''} Field bounty $${200 + 30 * n}.`, 'intel');
        m.progress('survive', `Wave ${n} · x${m.flags.mult.toFixed(2)}`);
      }
    }
    // boss defeated -> breather with a supply drop
    const boss = m.flags.boss as { n: number; ids: number[] } | null;
    if (boss) {
      let any = false;
      for (const id of boss.ids) { const e = m.world.getEntity(id); if (e && e.alive) { any = true; break; } }
      if (!any) {
        m.flags.boss = null;
        m.flags.bosses = (m.flags.bosses ?? 0) + 1;
        const cash = 1000 + 150 * boss.n;
        m.give(0, cash);
        m.addScore('Score', Math.round(1000 * (boss.n / 5) * m.flags.mult * scoreFactor(m, v)));
        const [bx, by] = baseCentre(m);
        dropCrates(m, bx, by, 3);
        const left = m.timeLeft('wave') ?? 0;
        m.startTimer('wave', left + 35, `Wave ${m.flags.wave + 1}`);
        m.say('Logistics', `Boss destroyed! Supply drop inbound: $${cash.toLocaleString('en-US')} and three crates near your base. Take a breather, commander.`, 'commander');
        m.announce('reinforcements');
      }
    }
  }

  // aircraft: re-target while armed, leave the map when empty
  if (m.every(1, 'air') && m.flags.air?.length) {
    const keep: number[] = [];
    const [bx, by] = baseCentre(m);
    for (const id of m.flags.air as number[]) {
      const u = m.world.getEntity(id) as Unit | undefined;
      if (!u || !u.alive) continue;
      keep.push(id);
      const edgeDist = Math.min(u.x, u.y, m.mapW - u.x, m.mapH - u.y);
      if (u.ammo <= 0) {
        if (edgeDist < 2.2 && m.flags.airOut?.[id]) { removeQuiet(m, u); keep.pop(); continue; }
        if (u.order.type !== 'move') {
          const ex = u.x < m.mapW / 2 ? 0.8 : m.mapW - 0.8, ey = u.y < m.mapH / 2 ? 0.8 : m.mapH - 0.8;
          const [tx, ty] = Math.min(u.x, m.mapW - u.x) < Math.min(u.y, m.mapH - u.y) ? [ex, u.y] : [u.x, ey];
          m.world.giveOrder(u, { type: 'move', x: tx, y: ty, attackMove: false });
          (m.flags.airOut ??= {})[id] = 1;
        }
      } else if (u.order.type === 'idle') {
        const t = nearestHumanTarget(m, bx, by, HORDES[v.horde].airTargets);
        if (t) orderAttack(m, [u], t.id);
      }
    }
    m.flags.air = keep;
  }

  if (m.flags.allies && m.every(8, 'allyHelp')) allyHelp(m); // co-op: teammates reinforce the human's base

  // keep stragglers pushing into the base; units that cannot find a way in desert after ~20 s
  if (m.every(6, 'push')) {
    const stuck: Record<number, [number, number, number]> = (m.flags.stuck ??= {});
    for (const u of m.world.units) {
      if (!u.alive || u.owner !== horde || u.kind === 'aircraft' || u.order.type !== 'idle' || u.target) continue;
      const s = stuck[u.id];
      if (s && Math.hypot(u.x - s[0], u.y - s[1]) < 1) {
        if (++s[2] >= 3) { removeQuiet(m, u); delete stuck[u.id]; continue; }
      } else stuck[u.id] = [u.x, u.y, 0];
      const t = nearestHumanTarget(m, u.x, u.y);
      if (t) orderMove(m, [u], t.x, t.y);
    }
    for (const k of Object.keys(stuck)) if (!m.world.getEntity(+k)?.alive) delete stuck[+k];
  }
}

function makeSurvival(v: SurvivalVariant, allies: CoopAlly[] = []): MissionDef {
  const n = allies.length; // co-op survival: AI teammates (players 2, 3) on the human's team
  const coopScore = n === 1 ? 0.8 : 0.65;
  return {
    id: n ? coopMissionId(v.id, allies) : v.id,
    campaign: 'special',
    index: v.index,
    title: n ? `${v.title} · Co-op` : v.title,
    codename: v.codename,
    location: v.location,
    briefing: [
      `${v.blurb} Hold the line for as long as you can: every wave is stronger than the last.`,
      `Expect infantry swarms, armour columns and air raids. Every fifth wave is a boss wave; destroy it for a supply drop and a breather.`,
      `Score: kills, waves survived and bosses destroyed. Clear a wave without losing a structure to raise your score multiplier (up to x5). Difficulty bonus x${v.factor.toFixed(2)}.`,
      ...(n ? [`Co-op: ${n === 1 ? 'an allied AI commander holds a base' : 'two allied AI commanders hold bases'} of their own nearby. The horde attacks every base in turn and its waves are bigger; any lost structure resets the multiplier, and score counts x${coopScore.toFixed(2)}.`] : []),
    ],
    tips: [
      'Air raids arrive on wave 3, 8, 13... Build anti-air before then.',
      'A lost structure resets your multiplier to x1. Walls and repairs pay off.',
      'Boss waves come every five waves; the supply drop after them buys you time.',
      ...(n ? ['Your allies send armour when your base is under heavy attack; return the favour.'] : []),
    ],
    map: { size: v.size + (n ? 8 : 0), seed: v.seed, players: 2 + n, water: v.water, trees: v.trees, ore: v.ore, climate: v.climate, hour: v.hour, dayCycle: true, weather: 'auto' },
    players: [
      { name: 'Commander', faction: v.human, color: COLOR[v.human] },
      { name: v.hordeName, faction: v.horde, color: v.horde === 'soviet' ? 0xd23a2c : 0xe0b030, ai: 'passive' },
      ...allies.map((a, i) => ({ name: ALLY_NAMES[i], faction: a.faction ?? v.human, color: ALLY_COLORS[i], team: 0, ai: a.difficulty, credits: 8000 })),
    ],
    startUnits: 'light',
    credits: 8000,
    scored: true,
    setup(m) {
      m.objective('survive', 'Survive the onslaught');
      m.objective('ten', 'Hold out for 10 waves', false);
      m.progress('ten', '0 / 10');
      Object.assign(m.flags, { wave: 0, survived: 0, mult: 1, bosses: 0, hordeLost: 0, humanBLost: 0, waveActive: false, waveLossMark: 0, air: [], boss: null, variant: v.id });
      // The horde has no base: flag it as eliminated so the HUD never announces its defeat between
      // waves. It is driven with direct orders (see orderMove), which the command queue would drop.
      m.player(1).defeated = true;
      if (n) {
        // the waves grow with each ally by what that ally can hold: a Normal ally added less than the 55% the waves used
        // to grow by, so a newcomer with one survived fewer waves than alone (tools/campaign-levels.ts --missions coop)
        const share: Record<string, number> = { recruit: 0.2, easy: 0.25, normal: 0.3, hard: 0.42, brutal: 0.55 };
        const budgetMul = 1 + allies.reduce((sum, a) => sum + (share[a.difficulty] ?? 0.55), 0);
        Object.assign(m.flags, { allies: n, budgetMul, coopScore, waveTargets: [] });
        for (let i = 0; i < n; i++) spawnKit(m, 2 + i, 'light');
      }
      m.startTimer('wave', 100, 'First wave');
      m.say('Command', `${v.hordeName} is massing beyond the ridge. Dig in, commander: first contact in under two minutes.`, 'commander');
      if (n) m.say(ALLY_NAMES[0], `${n === 1 ? 'My division holds' : 'Our divisions hold'} the flank${n > 1 ? 's' : ''}. We stand together, commander.`, 'commander');
    },
    update(m) {
      survivalUpdate(m, v);
    },
  };
}

export const SURVIVALS: MissionDef[] = SURVIVAL_VARIANTS.map((v) => makeSurvival(v));

// ---- co-op survival ids: "<variant>:coop:<ally>[+<ally>]", ally = "[faction.]difficulty" ----
export type CoopAlly = { faction?: Faction; difficulty: AIDifficulty };
const ALLY_NAMES = ['Gen. Hartmann', 'Col. Dubois'];
const ALLY_COLORS = [0x3fa34d, 0x2aa8a8];
const COOP_DIFFS: readonly AIDifficulty[] = AI_DIFFICULTIES; // (validation: the co-op picker offers Normal to Brutal allies)

/** Mission id of a co-op survival run (records and retries key on it). */
export function coopMissionId(variantId: string, allies: CoopAlly[]): string {
  const base = variantId.split(':')[0];
  if (!allies.length) return base;
  return `${base}:coop:${allies.slice(0, 2).map((a) => (a.faction ? `${a.faction}.` : '') + a.difficulty).join('+')}`;
}

/** Parse a co-op id (null if it isn't one). */
export function parseCoopId(id: string): { variant: SurvivalVariant; allies: CoopAlly[] } | null {
  const [base, tag, list] = id.split(':');
  const variant = SURVIVAL_VARIANTS.find((v) => v.id === base);
  if (!variant || tag !== 'coop' || !list) return null;
  const allies: CoopAlly[] = [];
  for (const part of list.split('+').slice(0, 2)) {
    const [f, d] = part.includes('.') ? part.split('.') : [undefined, part];
    if (!COOP_DIFFS.includes(d as AIDifficulty) || (f && f !== 'allies' && f !== 'soviet')) return null;
    allies.push({ faction: f as Faction | undefined, difficulty: d as AIDifficulty });
  }
  return allies.length ? { variant, allies } : null;
}

const coopCache = new Map<string, MissionDef>();
/** Co-op survival mission for an id (cached so records and the meta tracker see one definition). */
export function coopSurvival(id: string): MissionDef | undefined {
  let d = coopCache.get(id);
  if (d) return d;
  const p = parseCoopId(id);
  if (!p) return undefined;
  d = makeSurvival(p.variant, p.allies);
  coopCache.set(id, d);
  return d;
}
/** Classic Survival (temperate). The id `survival` is kept for old links and saves. */
export const SURVIVAL: MissionDef = SURVIVALS[0];

// =============================================================================
// DAILY CHALLENGE
// =============================================================================
const AI_NAMES = ['Gen. Volkov', 'Marshal Krukov', 'Col. Nadia', 'Gen. Stavros', 'Cdr. Bennett', 'Maj. Kane'];
const ENEMY_COLORS = [0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0];
const STATIC_DEFENCE = ['pbox', 'gun', 'agun', 'ftur', 'tsla', 'sam'];
const ALL_TYPES = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

let dayOverride: string | null = null;
/** Testing hook: pin the daily challenge to a date (null = today, UTC). */
export function setDailyDay(day: string | null) {
  dayOverride = day;
  cached = null;
}
export function currentDailyDay(): string {
  return dayOverride ?? dayKey();
}

function allowedFor(cfg: DailyConfig): string[] | undefined {
  const banned = new Set<string>();
  if (cfg.modifiers.includes('no-radar')) banned.add('dome');
  if (cfg.modifiers.includes('tesla-only')) for (const t of STATIC_DEFENCE) if (t !== 'tsla') banned.add(t);
  if (cfg.modifiers.includes('pillbox-line')) for (const t of STATIC_DEFENCE) if (t !== 'pbox') banned.add(t);
  return banned.size ? ALL_TYPES.filter((t) => !banned.has(t)) : undefined;
}

function enemyLabel(cfg: DailyConfig): string {
  const d = cfg.difficulty.charAt(0).toUpperCase() + cfg.difficulty.slice(1);
  const fac = (f: Faction) => (f === 'soviet' ? 'Soviet' : 'Allied');
  return cfg.enemies.length > 1 ? `two ${d} commanders (${cfg.enemies.map(fac).join(' and ')})` : `a ${d} ${fac(cfg.enemies[0])} commander`;
}

function spawnKit(m: MissionRuntime, p: number, kind: 'mcv' | 'light' | 'heavy') {
  const pl = m.player(p);
  const s = m.start(p);
  const toward = Math.atan2(m.mapH / 2 - s.y, m.mapW / 2 - s.x);
  m.spawnUnit(p, 'mcv', s.x, s.y, toward);
  if (kind === 'mcv') return;
  const tank = pl.faction === 'allies' ? '2tnk' : '3tnk';
  const extras = ['e1', 'e1', 'e1', 'e3', tank];
  if (kind === 'heavy') extras.push('e1', 'e1', 'e3', tank, pl.faction === 'allies' ? 'jeep' : 'v2rl');
  extras.forEach((t, k) => {
    const a = toward + (k - extras.length / 2) * 0.45;
    const r = UNITS[t].kind === 'infantry' ? 2.4 : 3.2;
    m.spawnUnit(p, t, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, toward);
  });
}

function dailySetup(m: MissionRuntime) {
  const day = currentDailyDay();
  const cfg = dailyConfig(day);
  m.flags.day = day;
  m.flags.kills = 0;
  m.flags.bkills = 0;
  m.flags.vetMax = 0;
  for (let i = 1; i < m.world.players.length; i++) spawnKit(m, i, cfg.startUnits);
  const has = (id: string) => cfg.modifiers.includes(id);
  const all = m.world.players;
  const foes = all.filter((p) => p !== m.human);
  if (has('double-ore')) for (const p of all) p.incomeBias *= 2;
  if (has('blizzard')) for (const p of all) p.incomeBias *= 0.8;
  if (has('sandstorm')) for (const p of all) p.incomeBias *= 0.85;
  if (has('fast-production')) for (const p of all) p.buildSpeed *= 2;
  if (has('fanatics')) for (const p of foes) { p.buildSpeed *= 1.35; p.incomeBias *= 1.2; }
  m.objective('destroy', `Destroy ${cfg.enemies.length > 1 ? 'both enemy commanders' : 'the enemy commander'}`);
  m.objective('swift', 'Win within 15:00', false);
  m.objective('disciplined', 'Lose fewer than 25 units', false);
  m.progress('disciplined', '0 / 25');
  if (has('glass-cannons')) glassCap(m);
  m.say('Command', `Daily Challenge #${cfg.number}, operation ${cfg.codename}. Conditions: ${cfg.modifiers.map((id) => MODIFIER_BY_ID[id]?.name ?? id).join(', ')}. Good hunting.`, 'commander');
}

function glassCap(m: MissionRuntime) {
  for (const u of m.world.units) {
    if (!u.alive) continue;
    const cap = u.maxHp * 0.6;
    if (u.hp > cap) u.hp = cap;
  }
}

function dailyUpdate(m: MissionRuntime) {
  const cfg = dailyConfig(m.flags.day ?? currentDailyDay());
  const has = (id: string) => cfg.modifiers.includes(id);
  if (has('glass-cannons') && m.world.tick % 5 === 0) glassCap(m);
  // Lean Times: a commander who built power and a barracks first can no longer afford the refinery (its price sits
  // half-paid in the queue) and the whole day freezes, the computer commanders included. Command advances what is
  // missing for one refinery, once per commander, to anyone stuck without one.
  if (has('lean-times') && m.time > 90 && m.every(10, 'creditLine')) {
    for (const p of m.world.players) {
      if (p.defeated || p.id < 0 || m.flags['creditLine' + p.id] || m.buildings(p, 'proc').length || m.units(p, 'harv').length || !p.has('fact')) continue;
      const queued = p.queues.structure.items.find((it) => it.type === 'proc');
      const need = (queued ? BUILDINGS.proc.cost - queued.paid : BUILDINGS.proc.cost) - p.credits;
      if (need <= 0) continue;
      m.flags['creditLine' + p.id] = true;
      p.cash += Math.ceil(need);
      if (p === m.human) m.say('Command', 'Command has advanced you the price of an Ore Refinery. Without ore there is no war: build it first.', 'commander');
    }
  }
  if (has('veteran-start') && m.every(1, 'vet')) {
    let max = m.flags.vetMax;
    for (const u of m.world.units) {
      if (!u.alive || u.owner !== m.human || u.id <= m.flags.vetMax) continue;
      if (u.rank < 1 && u.weapons.length) { u.rank = 1; u.xp = Math.max(u.xp, Math.max(300, u.ut.cost)); }
      if (u.id > max) max = u.id;
    }
    m.flags.vetMax = max;
  }
  if (has('credits-rain')) {
    if (m.every(30, 'rain')) for (const p of m.world.players) p.cash += 400;
    if (m.every(45, 'crate') && m.world.crates.length < 6) {
      const map = m.world.map;
      for (let tries = 0; tries < 40; tries++) {
        const x = m.world.rng.int(3, map.w - 4), y = m.world.rng.int(3, map.h - 4);
        if (!map.passable(x, y) || map.occupant[map.idx(x, y)]) continue;
        m.flags.crateSeq = (m.flags.crateSeq ?? 0) + 1;
        m.world.crates.push({ id: 6_500_000 + m.flags.crateSeq, x: x + 0.5, y: y + 0.5 });
        break;
      }
    }
  }
  if (m.every(1, 'score')) {
    const st = m.human.stats;
    const dk = st.unitsKilled - m.flags.kills, db = st.buildingsKilled - m.flags.bkills;
    if (dk > 0 || db > 0) {
      m.flags.kills = st.unitsKilled;
      m.flags.bkills = st.buildingsKilled;
      m.addScore('Score', Math.round((dk * 5 + db * 20) * cfg.multiplier));
      if (has('bounty')) m.give(0, dk * 100 + db * 300);
    }
    if (m.objectives.find((o) => o.id === 'disciplined')?.state === 'active') {
      m.progress('disciplined', `${Math.min(25, st.unitsLost)} / 25`);
      if (st.unitsLost >= 25) m.fail('disciplined');
    }
    if (m.time > 900) m.fail('swift');
    const foes = m.world.players.filter((p) => p !== m.human && m.human.isEnemy(p));
    if (foes.length && foes.every((p) => p.defeated)) {
      const s = dailyVictoryScore(cfg, m.time, st.unitsLost);
      if (s.losses) m.addScore('Losses', s.losses);
      if (s.speed) m.addScore('Speed bonus', s.speed);
      m.addScore('Victory', s.victory);
      m.complete('destroy');
      if (m.time <= 900) m.complete('swift');
      if (st.unitsLost < 25) m.complete('disciplined');
      m.win();
    }
  }
}

function buildDaily(day: string): MissionDef {
  const cfg = dailyConfig(day);
  const [y, mo, d] = day.split('-').map(Number);
  const names = [...AI_NAMES];
  const nameAt = (i: number) => names[(cfg.seed + i * 3) % names.length];
  const humanColor = COLOR[cfg.faction];
  const colors = ENEMY_COLORS.filter((c) => c !== humanColor);
  const mods = cfg.modifiers.map((id) => MODIFIER_BY_ID[id]).filter(Boolean);
  return {
    id: 'daily',
    campaign: 'special',
    index: 4,
    title: `Daily Challenge #${cfg.number}`,
    codename: cfg.codename,
    location: cfg.location,
    date: `${String(d).padStart(2, '0')} ${MONTHS[mo - 1]} ${y}`,
    briefing: [
      `${cfg.location}. ${enemyLabel(cfg).charAt(0).toUpperCase() + enemyLabel(cfg).slice(1)} holds the field. Destroy every enemy structure and unit.`,
      `Today's conditions: ${mods.map((x) => x.name).join(' · ')}.`,
      `Score: victory, speed and losses, x${cfg.multiplier.toFixed(2)} challenge multiplier, plus 500 per medal earned. A new challenge is issued every day at 00:00 UTC.`,
    ],
    tips: mods.map((x) => `${x.name}: ${x.desc}`),
    map: { size: cfg.size, seed: cfg.seed, players: 1 + cfg.enemies.length, water: cfg.water, trees: cfg.trees, ore: cfg.ore, climate: cfg.climate, hour: cfg.hour, dayCycle: cfg.dayCycle, weather: cfg.weather },
    players: [
      { name: 'Commander', faction: cfg.faction, color: humanColor },
      ...cfg.enemies.map((f, i) => ({ name: nameAt(i), faction: f, color: colors[i % colors.length], ai: cfg.difficulty, credits: cfg.credits, team: i + 1 })),
    ],
    fog: cfg.fog,
    startUnits: cfg.startUnits,
    credits: cfg.credits,
    allowedBuild: allowedFor(cfg),
    parTime: 900,
    scored: true,
    setup: dailySetup,
    update: dailyUpdate,
  };
}

let cached: { day: string; def: MissionDef } | null = null;
/** Today's daily challenge definition (UTC; cached per day). */
export function dailyMission(day = currentDailyDay()): MissionDef {
  if (!cached || cached.day !== day) cached = { day, def: buildDaily(day) };
  return cached.def;
}

/**
 * Registry entry with a stable id. Data fields resolve to today's challenge on access, so a menu
 * left open past midnight deploys the new one. The scripts pin the day in m.flags.day at setup.
 */
export const DAILY: MissionDef = {
  id: 'daily',
  campaign: 'special',
  index: 4,
  get title() { return dailyMission().title; },
  get codename() { return dailyMission().codename; },
  get location() { return dailyMission().location; },
  get date() { return dailyMission().date; },
  get briefing() { return dailyMission().briefing; },
  get tips() { return dailyMission().tips; },
  get map() { return dailyMission().map; },
  get players() { return dailyMission().players; },
  get fog() { return dailyMission().fog; },
  get startUnits() { return dailyMission().startUnits; },
  get credits() { return dailyMission().credits; },
  get allowedBuild() { return dailyMission().allowedBuild; },
  parTime: 900,
  scored: true,
  setup: dailySetup,
  update: dailyUpdate,
};

export { DAILY_MODIFIERS };
export const SPECIAL_MISSIONS: MissionDef[] = [...SURVIVALS, DAILY];
