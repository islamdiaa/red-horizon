/**
 * AI use of the land/air content (called from AIController.think): spies and thieves, minelayers mining
 * the approaches to the base, support powers (spy plane, paratroopers, parabombs, sonar; GPS launches by
 * itself). Stateless: everything is derived from the world each think, so nothing extra needs saving.
 * The AI knows enemy structures only from its intel (ai-intel.ts: what its side has seen, no map-hack):
 * decoys fool it and disguised spies are ignored. The subterfuge trait of the commander personality scales how
 * much it invests in agents, mines and air drops; drops are timed with its attack waves.
 */
import { Building, Unit } from './entities';
import type { Player } from './player';
import { superReady } from './superweapons';
import { TICK_HZ } from './types';
import type { World } from './world';
import { apparentType } from './infiltration';
import { allMines, mineable } from './mines';
import { sortieRoute } from './powers';
import type { AIIntel } from './ai-intel';
import { trait, type Personality } from './ai-personality';
import { ceasefireActive } from './ceasefire';

/** The parts of AIController this module uses (its members are private to TypeScript only). */
interface AIView {
  world: World;
  p: Player;
  d: { superweapons: boolean; defenses: number; skill?: number };
  thinks: number;
  difficulty: string;
  personality?: Personality;
  intel?: AIIntel;
  state?: string;
  stage?: string;
  stageTarget?: [number, number];
  /** The Allied AI's radar spy (ai-allies.ts walks it in itself). */
  radarSpy?: number;
  baseCenter(): [number, number];
  enemyDir(): [number, number];
}

/** The commander's subterfuge trait (0.5 without a personality). */
const sub = (v: AIView) => v.personality?.subterfuge ?? 0.5;

const MAX_MINES = 15;
const SPY_PRIORITY: Record<string, number> = { spen: 5, dome: 4, proc: 3, silo: 1, powr: 2, apwr: 2, weap: 2, fact: 1 };

export function contentAI(ai: unknown) {
  const v = ai as AIView;
  const p = v.p;
  if (p.defeated) return;
  const due = (sec: number) => v.thinks % Math.max(1, Math.round((sec * TICK_HZ) / 10)) === 0;
  supportPowers(v, due);
  if (due(3)) agents(v, due);
  if (due(3)) minelayers(v, due);
}

/** Enemy structures the AI knows of (all of them without intel). */
function enemyBuildings(v: AIView): Building[] {
  return v.world.buildings.filter((b) => b.alive && v.p.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine && (!v.intel || v.intel.structures.has(b.id)));
}

function queued(p: Player, type: string): boolean {
  return Object.values(p.queues).some((q) => q.items.some((it) => it.type === type));
}

// ---------------------------------------------------------------------------
// Support powers (RA Special_Weapon_AI: the most valuable enemy structure, here weighed against air defence)
// ---------------------------------------------------------------------------

function groundDefence(world: World, owner: Player, x: number, y: number, r: number): number {
  let n = 0;
  for (const b of world.buildings) if (b.alive && b.owner === owner && b.weapons.length && b.bt.id !== 'sam' && b.bt.id !== 'agun' && Math.hypot(b.x - x, b.y - y) < r) n++;
  return n;
}

interface Flak { x: number; y: number; r: number }

/** Enemy anti-aircraft sites (structures the AI knows of, AA units it can see) with their reach. */
function enemyFlak(v: AIView): Flak[] {
  const w = v.world, p = v.p;
  const out: Flak[] = [];
  for (const b of enemyBuildings(v)) {
    if (b.active && b.weapons.length && b.weapons[0].def.antiAir) out.push({ x: b.x, y: b.y, r: b.weapons[0].def.range + 1 });
  }
  for (const u of w.units) {
    if (!u.alive || !p.isEnemy(u.owner) || u.kind === 'aircraft' || !w.canSee(p, u)) continue;
    for (const s of u.weapons) if (s.def.antiAir) { out.push({ x: u.x, y: u.y, r: s.def.range + 1 }); break; }
  }
  return out;
}

/** How many of those sites a support plane would fly past on its way to (tx, ty). */
function flakOnRoute(v: AIView, flak: Flak[], tx: number, ty: number): number {
  if (!flak.length) return 0;
  const r = sortieRoute(v.world, v.p, tx, ty);
  const len = Math.hypot(tx - r.sx, ty - r.sy);
  let n = 0;
  for (const f of flak) {
    // closest approach of the flight line (up to the target) to this site
    const t = Math.max(0, Math.min(len, (f.x - r.sx) * r.dx + (f.y - r.sy) * r.dy));
    if (Math.hypot(r.sx + r.dx * t - f.x, r.sy + r.dy * t - f.y) <= f.r) n++;
  }
  return n;
}

function supportPowers(v: AIView, due: (s: number) => boolean) {
  const w = v.world, p = v.p;
  if (!due(1)) return;
  if (superReady(w, p, 'spyplane')) {
    // photograph the most valuable structure we can't see right now
    let best: Building | null = null, bestScore = 0;
    for (const b of enemyBuildings(v)) {
      const score = apparentType(b, p).cost;
      if (score > bestScore && !w.canSee(p, b)) { bestScore = score; best = b; }
    }
    if (best) w.issue({ c: 'superweapon', player: p.id, kind: 'spyplane', x: best.x, y: best.y });
    else if (v.intel && !v.intel.omniscient) {
      // nothing known yet: a reconnaissance flight over the likeliest enemy base
      const [bx, by] = v.baseCenter();
      const guess = v.intel.candidateStarts(bx, by)[0];
      if (guess) w.issue({ c: 'superweapon', player: p.id, kind: 'spyplane', x: guess[0], y: guess[1] });
    }
  }
  if (superReady(w, p, 'sonar') && w.units.some((u) => u.alive && u.ut.cloakable && p.isEnemy(u.owner))) {
    w.issue({ c: 'superweapon', player: p.id, kind: 'sonar', x: 0, y: 0 });
  }
  // (build-up time: reconnaissance only, no drops on the enemy)
  if (!v.d.superweapons || !due(4) || ceasefireActive(w)) return;
  const bombs = superReady(w, p, 'parabombs'), troops = superReady(w, p, 'paratroopers');
  if (!bombs && !troops) return;
  // timed with the attack: while a wave is out (normal and up, skirmish) the drop goes to its target area.
  // (Drops are never held back: they recharge on their own, so a held drop is a lost one.)
  let targets = enemyBuildings(v);
  if ((v.d.skill ?? 0) >= 0.6 && !w.mission && v.stageTarget && v.state === 'attack') {
    const [tx, ty] = v.stageTarget;
    const near = targets.filter((b) => Math.hypot(b.x - tx, b.y - ty) < 14);
    if (near.length) targets = near;
  }
  const flak = enemyFlak(v);
  if (bombs) {
    // the richest cluster of structures the Badger can reach without flying past air defences
    let best: Building | null = null, bestScore = 1500;
    for (const b of targets) {
      let value = 0;
      for (const o of targets) if (o.owner === b.owner && Math.abs(o.x - b.x) < 3 && Math.abs(o.y - b.y) < 3 && Math.hypot(o.x - b.x, o.y - b.y) < 3) value += apparentType(o, p).cost;
      if (value <= bestScore) continue;
      // a Badger (60 hp) doesn't survive flying past even one AA site
      if (flakOnRoute(v, flak, b.x, b.y) > 0) continue;
      bestScore = value;
      best = b;
    }
    if (best) w.issue({ c: 'superweapon', player: p.id, kind: 'parabombs', x: best.x, y: best.y });
  }
  if (troops) {
    // a valuable structure with few defences around it (refineries and power first)
    let best: Building | null = null, bestScore = 400;
    for (const b of targets) {
      const t = apparentType(b, p);
      const bonus = t.id === 'proc' || t.power > 0 ? 600 : 0;
      const score = Math.min(t.cost, 2500) + bonus - 700 * groundDefence(w, b.owner, b.x, b.y, 7);
      if (score <= bestScore || flakOnRoute(v, flak, b.x, b.y) > 0) continue;
      bestScore = score;
      best = b;
    }
    if (best) {
      // land beside it, not on the roof
      const [bx, by] = v.baseCenter();
      const a = Math.atan2(by - best.y, bx - best.x);
      const [x, y] = w.findFreeSpot(best.x + Math.cos(a) * 2.5, best.y + Math.sin(a) * 2.5, 3, false);
      w.issue({ c: 'superweapon', player: p.id, kind: 'paratroopers', x, y });
    }
  }
}

// ---------------------------------------------------------------------------
// Spies and thieves
// ---------------------------------------------------------------------------

function agents(v: AIView, due: (s: number) => boolean) {
  const w = v.world, p = v.p;
  const mine = w.units.filter((u) => u.alive && u.owner === p && (u.ut.spy || u.ut.thief));
  const spies = mine.filter((u) => u.ut.spy), thieves = mine.filter((u) => u.ut.thief);
  const targets = enemyBuildings(v);
  // send idle agents in (not during the build-up time: they wait at home)
  const truce = ceasefireActive(w);
  for (const u of mine) {
    if (u.order.type !== 'idle' || truce || u.id === v.radarSpy) continue;
    let best: Building | null = null, bestScore = -Infinity;
    for (const b of targets) {
      const t = apparentType(b, p);
      let score: number;
      if (u.ut.thief) {
        if (!b.bt.storage) continue;
        score = 10;
      } else {
        // already spied: nothing new to learn
        if (b.spiedBy & (1 << p.id)) continue;
        score = SPY_PRIORITY[t.id] ?? 0;
        if (t.id === 'spen' && p.sonarCharges > 0) score = 0;
        if (score <= 0) continue;
      }
      score -= Math.hypot(b.x - u.x, b.y - u.y) * 0.05 + groundDefence(w, b.owner, b.x, b.y, 5) * 0.5;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (best) w.issue({ c: 'enter', player: p.id, units: [u.id], target: best.id });
  }
  const s = sub(v);
  // (agents are a luxury: once the economy is up, unless the commander lives for this)
  if (s < 0.1 || w.time < 600 * trait(s, 1.5, 0.6) || p.credits < 700 * trait(s, 1.6, 0.6) || !targets.length) return;
  if (spies.length < (s >= 0.85 ? 2 : 1) && p.canBuild('spy') && !queued(p, 'spy') &&
    targets.some((b) => ['dome', 'spen', 'proc', 'powr', 'apwr'].includes(apparentType(b, p).id) && !(b.spiedBy & (1 << p.id)))) {
    w.issue({ c: 'build', player: p.id, type: 'spy' });
  }
  if (!thieves.length && w.time > 900 * trait(s, 1.5, 0.6) && p.credits > 1200 && p.canBuild('thf') && !queued(p, 'thf') && due(120 * trait(s, 1.5, 0.5)) && targets.some((b) => !!b.bt.storage)) {
    w.issue({ c: 'build', player: p.id, type: 'thf' });
  }
}

// ---------------------------------------------------------------------------
// Minelayers: fields across the approach the enemy comes from
// ---------------------------------------------------------------------------

function minelayers(v: AIView, due: (s: number) => boolean) {
  const w = v.world, p = v.p;
  const layers = w.units.filter((u) => u.alive && u.owner === p && u.ut.minelayer);
  const mines = allMines(w).filter((b) => b.owner === p).length;
  const maxMines = Math.round(MAX_MINES * trait(sub(v), 0, 2.2));
  if (!layers.length) {
    if (mines < maxMines && w.time > 420 * trait(sub(v), 1.5, 0.6) && p.credits > 1000 && p.canBuild('mnly') && !queued(p, 'mnly')) {
      w.issue({ c: 'build', player: p.id, type: 'mnly' });
    }
    return;
  }
  for (const u of layers) {
    if (u.order.type !== 'idle') continue;
    const max = u.ut.ammo ?? 5;
    if (u.ammo < max) {
      if (onDepot(w, u)) continue; // re-arming
      const depot = w.buildings.find((b) => b.alive && b.owner === p && b.bt.repairPad && b.active);
      if (depot) w.issue({ c: 'enter', player: p.id, units: [u.id], target: depot.id });
      else if (u.ammo > 0 && mines < maxMines) layField(v, u);
      continue;
    }
    if (mines < maxMines) layField(v, u);
  }
}

function onDepot(w: World, u: Unit): boolean {
  const id = w.map.occupant[w.map.idx(Math.floor(u.x), Math.floor(u.y))];
  const b = id ? w.entities.get(id) : undefined;
  return b instanceof Building && !!b.bt.repairPad && b.owner === u.owner;
}

function layField(v: AIView, u: Unit) {
  const w = v.world, p = v.p;
  const [bx, by] = v.baseCenter();
  const [ex, ey] = v.enemyDir();
  for (let k = 0; k < 8; k++) {
    const dist = w.rng.range(8, 12);
    const side = w.rng.range(-5, 5);
    const x = bx + ex * dist - ey * side, y = by + ey * dist + ex * side;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!mineable(w, cx, cy) || w.map.ore[w.map.idx(cx, cy)] || w.map.reserved[w.map.idx(cx, cy)]) continue;
    // keep fields off our own doorstep and away from existing fields
    if (w.buildings.some((b) => b.alive && b.owner === p && (b.bt.mine ? Math.hypot(b.x - x, b.y - y) < 3 : b.distTo(x, y) < 3))) continue;
    w.issue({ c: 'mine', player: p.id, units: [u.id], x: cx + 0.5, y: cy + 0.5 });
    return;
  }
}

