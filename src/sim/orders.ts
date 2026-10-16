/**
 * [CTRL] Unit control beyond RA's orders:
 * - patrol: loop through waypoints, attack-moving (engagements resume the loop where they left it);
 * - escort / guard: keep station around an own or allied unit or structure and defend it (its attackers first,
 *   never chasing far from it); medics heal around it;
 * - rally to a unit: a factory's new units join and escort that unit;
 * - build plan: the Construction Yard builds the planned structures in order, each as soon as it is affordable,
 *   and places it on its planned cell (or the nearest valid cell within 3);
 * - focus fire: target choice knows how much damage is already on its way to each enemy, so a group finishes
 *   wounded targets with just enough shooters and spreads the rest over other targets instead of overkilling;
 * - kiting: ranged units back off from enemies they out-range while reloading (turreted units keep firing on
 *   the move). Hold-position and hold-fire stances never kite.
 *
 * Hooks: World.processCommand -> ordersCommand; World.step -> ordersPreTick; unitlogic.updateUnit ->
 * updateCtrlOrder (order switch) and ordersUnitStep (after it); production.spawnProduced -> rallyNewUnit;
 * combat.findTarget -> focusBias.
 */
import { ARMOR_INDEX, BUILDINGS, WARHEADS, mphToCellsPerSecond, rotToRadPerSecond } from '../data/rules';
import { angleDiff } from '../core/util';
import { Building, Unit, distToEntity, type Entity, type WeaponSlot } from './entities';
import { findHealTarget, findTarget, maxRange, pickWeapon } from './combat';
import { clearLine, setFormation, steerTo, updateFormations } from './formation';
import type { Player } from './player';
import type { Command, Order, PlanItem } from './types';
import type { World } from './world';

type PatrolOrder = Extract<Order, { type: 'patrol' }>;
type EscortOrder = Extract<Order, { type: 'escort' }>;

const speedOf = (u: Unit) => mphToCellsPerSecond(u.ut.speed);

function owned(world: World, p: Player, ids: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const e = world.entities.get(id);
    if (e instanceof Unit && e.alive && e.owner === p && !e.transport) out.push(e);
  }
  return out;
}

function stopMoving(u: Unit) {
  u.path = null;
  u.hasGoal = false;
  u.pathPending = false;
}

function finish(world: World, u: Unit) {
  const next = u.orderQueue.shift();
  if (next) world.setOrder(u, next);
  else {
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** World.processCommand hook for the CTRL commands. */
export function ordersCommand(world: World, cmd: Command) {
  const p = world.players[cmd.player];
  if (!p) return;
  switch (cmd.c) {
    case 'patrol':
      orderPatrol(world, owned(world, p, cmd.units ?? []), cmd.points ?? [], !!cmd.queue);
      break;
    case 'guard':
      orderGuard(world, p, owned(world, p, cmd.units ?? []), cmd.target, !!cmd.queue);
      break;
    case 'formation':
      setFormation(world, owned(world, p, cmd.units ?? []), cmd.shape);
      break;
    case 'rallyUnit': {
      const b = world.entities.get(cmd.building);
      if (!(b instanceof Building) || b.owner !== p || !b.bt.factory || b.bt.factory === 'building') return;
      const t = world.entities.get(cmd.target);
      b.rallyUnit = t instanceof Unit && t.alive && t.owner === p && t.kind !== 'aircraft' && !t.transport ? t.id : 0;
      break;
    }
    case 'queuePlan':
      queuePlan(world, p, Array.isArray(cmd.items) ? cmd.items : [], cmd.mode ?? 'append');
      break;
  }
}

/** Each unit loops from where it stands (or where its queued orders end) through the points, keeping its place in the group. */
function orderPatrol(world: World, units: Unit[], pts: [number, number][], queue: boolean) {
  const m = world.map;
  const points = pts.filter((q) => Array.isArray(q) && finite(q[0]) && finite(q[1])).slice(0, 16);
  const list = units.filter((u) => u.kind !== 'aircraft');
  if (!points.length || !list.length) return;
  let cx = 0, cy = 0;
  for (const u of list) { cx += u.x; cy += u.y; }
  cx /= list.length; cy /= list.length;
  const clampX = (x: number) => Math.min(m.w - 0.5, Math.max(0.5, x));
  const clampY = (y: number) => Math.min(m.h - 0.5, Math.max(0.5, y));
  for (const u of list) {
    let ox = u.x - cx, oy = u.y - cy;
    const l = Math.hypot(ox, oy);
    if (l > 2) { ox *= 2 / l; oy *= 2 / l; }
    let fx = u.x, fy = u.y;
    if (queue) {
      const last = u.orderQueue.length ? u.orderQueue[u.orderQueue.length - 1] : u.order;
      if ('x' in last && finite(last.x) && finite(last.y)) { fx = last.x; fy = last.y; }
    }
    const route: [number, number][] = [[fx, fy], ...points.map(([x, y]): [number, number] => [clampX(x + ox), clampY(y + oy)])];
    world.giveOrder(u, { type: 'patrol', points: route, idx: 1 }, queue);
  }
}

/** Escorts take stations behind and beside a unit, or spread round a structure. */
function orderGuard(world: World, p: Player, units: Unit[], targetId: number, queue: boolean) {
  const t = world.entities.get(targetId);
  if (!t || !t.alive || p.isEnemy(t.owner) || (t instanceof Unit && (t.transport || t.kind === 'aircraft'))) return;
  const list = units.filter((u) => u !== t && u.kind !== 'aircraft');
  const n = list.length;
  list.forEach((u, k) => {
    let a: number, r: number;
    if (t instanceof Building) {
      a = Math.PI / 2 + (2 * Math.PI * k) / Math.max(1, n);
      r = Math.max(t.w, t.h) / 2 + 1.3 + 0.8 * Math.floor(k / 12);
    } else {
      const ring = Math.floor(k / 6), j = k % 6, inRing = Math.min(6, n - ring * 6);
      a = Math.PI + (j - (inRing - 1) / 2) * 0.75;
      r = (t as Unit).ut.radius + 1.0 + ring * 0.8;
    }
    world.giveOrder(u, { type: 'escort', target: t.id, a, r }, queue);
  });
}

/** production.spawnProduced hook: a factory rallying to a unit sends its new units to escort it. */
export function rallyNewUnit(world: World, f: Building, u: Unit) {
  if (!f.rallyUnit) return;
  const t = world.entities.get(f.rallyUnit);
  if (!(t instanceof Unit) || !t.alive || t.owner !== f.owner || t.transport) { f.rallyUnit = 0; return; }
  if (u.kind === 'aircraft' || u.ut.harvester) return;
  let k = 0;
  for (const o of world.units) if (o.alive && o.order.type === 'escort' && o.order.target === t.id) k++;
  const ring = Math.floor(k / 6), j = k % 6;
  world.setOrder(u, { type: 'escort', target: t.id, a: Math.PI + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.7, r: t.ut.radius + 1.0 + ring * 0.8 });
}

// ---------------------------------------------------------------------------
// Per-unit orders
// ---------------------------------------------------------------------------

/** unitlogic order switch: patrol / escort. */
export function updateCtrlOrder(world: World, u: Unit, o: Order) {
  if (o.type === 'patrol') updatePatrol(world, u, o);
  else if (o.type === 'escort') updateEscort(world, u, o);
}

function updatePatrol(world: World, u: Unit, o: PatrolOrder) {
  if (!o.points?.length) { finish(world, u); return; }
  if (o.idx >= o.points.length || o.idx < 0) o.idx = 0;
  // engage on the way like an attack-move; the attack resumes this very order (same leg)
  if (u.weapons.length && !u.ut.medic && --u.scanTimer <= 0) {
    u.scanTimer = 7; // (odd periods alternate with the update direction: no side scans first every time)
    const sight = Math.max(u.ut.sight, maxRange(u));
    const t = findTarget(world, u, sight, sight);
    if (t) {
      o.started = false;
      world.setOrder(u, { type: 'attack', target: t.id, forced: false, resume: o });
      u.target = t;
      return;
    }
  }
  if (!u.hasGoal && !u.pathPending && !u.path) {
    const [px, py] = o.points[o.idx];
    if (o.started || Math.hypot(px - u.x, py - u.y) < 0.6) {
      // there (or as close as it gets): on to the next point, round and round
      o.idx = (o.idx + 1) % o.points.length;
      o.started = false;
      return;
    }
    o.started = true;
    world.requestPath(u, px, py);
  }
}

/** Where an escort keeps station: behind / beside a unit (turning with it), round a structure. */
function stationOf(t: Entity, o: EscortOrder): [number, number] {
  if (t instanceof Building) return [t.x + Math.cos(o.a) * o.r, t.y + Math.sin(o.a) * o.r];
  const h = (t as Unit).heading + o.a;
  return [t.x + Math.cos(h) * o.r, t.y + Math.sin(h) * o.r];
}

function validFoe(world: World, u: Unit, t: Entity | null | undefined): t is Entity {
  return !!t && t.alive && u.owner.isEnemy(t.owner) && world.canSee(u.owner, t) && !!pickWeapon(u, t);
}

function updateEscort(world: World, u: Unit, o: EscortOrder) {
  const g = world.entities.get(o.target);
  if (!g || !g.alive || u.owner.isEnemy(g.owner) || (g instanceof Unit && g.transport)) { finish(world, u); return; }
  const reach = Math.max(u.ut.sight, maxRange(u));
  // --- defend: whoever is shooting at the charge (or at us) first, then anything coming close
  if (u.weapons.length && u.stance !== 'passive') {
    const heal = u.weapons[0].def.damage < 0;
    let t: Entity | null = u.target;
    if (heal) {
      if (t && (!t.alive || t.hp >= t.maxHp)) t = u.target = null;
      if (!t && --u.scanTimer <= 0) { u.scanTimer = 10; t = u.target = findHealTarget(world, u, u.ut.sight); }
    } else {
      if (t && (!validFoe(world, u, t) || distToEntity(g.x, g.y, t) > reach + 4)) t = u.target = null;
      for (const victim of [g, u]) {
        if (world.tick - victim.lastDamagedTick >= 20 || !victim.lastAttacker) continue;
        const a = world.entities.get(victim.lastAttacker);
        if (a !== t && validFoe(world, u, a) && distToEntity(g.x, g.y, a) <= reach + 4) { t = u.target = a; break; }
      }
      if (!t && --u.scanTimer <= 0) {
        u.scanTimer = 6 + (u.id % 5);
        // a structure's guards cover the ground all round it
        t = u.target = findTarget(world, u, g instanceof Building ? reach + 2.5 : reach);
        if (t && distToEntity(g.x, g.y, t) > reach + 4) t = u.target = null;
      }
    }
    if (t) {
      const slot = pickWeapon(u, t);
      const range = slot ? slot.def.range : 1.6;
      const d = distToEntity(u.x, u.y, t);
      if (d > range - 0.05) {
        if (u.stance !== 'hold' && !u.pathPending && (!u.path || Math.hypot(t.x - u.goalX, t.y - u.goalY) > 1 || world.tick % 15 === 0)) world.requestPath(u, t.x, t.y);
      } else stopMoving(u);
      if (u.stance !== 'hold' || d <= range) return;
    }
  }
  // --- keep station
  let [sx, sy] = stationOf(g, o);
  if (!world.map.passable(Math.floor(sx), Math.floor(sy))) { sx = g.x + (sx - g.x) * 0.6; sy = g.y + (sy - g.y) * 0.6; }
  const d = Math.hypot(sx - u.x, sy - u.y);
  const gMoving = g instanceof Unit && g.moving;
  if (d < (gMoving ? 0.3 : 0.7)) { if (!gMoving) stopMoving(u); return; }
  if (u.stance === 'hold' && !gMoving && d < 2) return;
  if (d < 4 && clearLine(world, u.x, u.y, sx, sy)) {
    steerTo(u, sx, sy);
    // don't overtake the unit being escorted
    u.speedCap = gMoving && d < 1.5 ? Math.max(0.5, speedOf(g as Unit)) : 0;
  } else if (!u.pathPending && (!u.path || Math.hypot(sx - u.goalX, sy - u.goalY) > 1.5 || world.tick % 19 === u.id % 19)) {
    u.speedCap = 0;
    world.requestPath(u, sx, sy);
  }
}

// ---------------------------------------------------------------------------
// Build plan
// ---------------------------------------------------------------------------

const PLAN_MAX = 40;

function queuePlan(world: World, p: Player, items: PlanItem[], mode: 'append' | 'replace' | 'remove') {
  const ok = (it: PlanItem) => !!it && typeof it.type === 'string' && !!BUILDINGS[it.type] && Number.isInteger(it.cx) && Number.isInteger(it.cy)
    && world.map.inBounds(it.cx, it.cy);
  const same = (a: PlanItem, b: PlanItem) => a.type === b.type && a.cx === b.cx && a.cy === b.cy;
  const plan = p.buildPlan;
  if (mode === 'remove') {
    for (const it of items) {
      const k = plan.findIndex((x) => same(x, it));
      if (k < 0) continue;
      const x = plan[k];
      // dropping the one in production cancels it (refund) unless it is already finished
      if (k === 0 && x.started && x.placing === undefined && p.queues.structure.items[0]?.type === x.type) world.issue({ c: 'cancel', player: p.id, type: x.type });
      plan.splice(k, 1);
    }
    return;
  }
  if (mode === 'replace') plan.length = 0;
  for (const it of items) {
    if (!ok(it) || plan.length >= PLAN_MAX || plan.some((x) => same(x, it))) continue;
    plan.push({ type: it.type, cx: it.cx, cy: it.cy });
  }
}

/** Nearest valid cell within 3 of the planned one (the planned cell itself if valid). */
function planSpot(world: World, p: Player, it: PlanItem): [number, number] | null {
  if (world.canPlace(p, it.type, it.cx, it.cy)) return [it.cx, it.cy];
  for (let r = 1; r <= 3; r++) {
    let best: [number, number] | null = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD && world.canPlace(p, it.type, it.cx + dx, it.cy + dy)) { bestD = d; best = [it.cx + dx, it.cy + dy]; }
    }
    if (best) return best;
  }
  return null;
}

function stepPlan(world: World, p: Player) {
  const plan = p.buildPlan;
  const head = plan[0];
  const bt = BUILDINGS[head.type];
  if (!bt || !bt.buildable || !bt.owner.includes(p.faction) || (p.allowedTypes && !p.allowedTypes.has(head.type))) { plan.shift(); return; }
  const q = p.queues.structure;
  if (q.ready) {
    // something else finished first: the player places that one
    if (q.ready !== head.type) return;
    if (head.placing !== undefined && world.tick - head.placing < 10) return;
    const spot = planSpot(world, p, head);
    if (spot) {
      world.issue({ c: 'place', player: p.id, type: head.type, cx: spot[0], cy: spot[1] });
      head.placing = world.tick;
      head.cx = spot[0];
      head.cy = spot[1];
      head.started = true;
    } else if ((head.wait = (head.wait ?? 0) + 1) % 120 === 1) world.announce(p, 'cannot_build_here', 1);
    return;
  }
  // placed (or the finished structure was cancelled): next
  if (head.placing !== undefined) { plan.shift(); return; }
  if (q.items.length) {
    if (q.items[0].type === head.type) head.started = true;
    return;
  }
  // it was in production and is gone: cancelled from the sidebar
  if (head.started) { plan.shift(); return; }
  if (!p.canBuild(head.type) || p.credits < bt.cost) return;
  world.issue({ c: 'build', player: p.id, type: head.type });
  head.started = true;
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

/** World.step hook, before buildings and units update. */
export function ordersPreTick(world: World) {
  takeFocusSnapshot(world);
  if (world.tick % 3 === 0) spreadFire(world, snapshots.get(world)!);
  updateFormations(world);
  if (world.tick % 5 === 0) {
    for (const p of world.players) if (p.buildPlan.length && !p.defeated) stepPlan(world, p);
  }
}

/** unitlogic.updateUnit hook after the order logic: kiting. */
export function ordersUnitStep(world: World, u: Unit) {
  const t = u.target;
  if (!t || !u.weapons.length || (u.kind !== 'infantry' && u.kind !== 'vehicle')) return;
  const o = u.order;
  if (!(o.type === 'idle' || o.type === 'guard' || o.type === 'escort' || (o.type === 'attack' && !o.forced))) return;
  kite(world, u);
}

// ---------------------------------------------------------------------------
// Focus fire
// ---------------------------------------------------------------------------

/**
 * Damage on its way to each enemy unit (one volley of everybody aiming at it) and its health, taken once per
 * tick before anything updates. Target choice reads only this snapshot (never what other units chose earlier in
 * the same tick), so the order units update in can't favour either side. Rebuilt every tick from saved state,
 * so it needs no saving.
 */
interface FocusSnapshot { tick: number; pledge: Map<number, number>; hp: Map<number, number>; mine: Map<number, [number, number]> }
const snapshots = new WeakMap<World, FocusSnapshot>();

function volley(e: Entity, t: Entity, slot: WeaponSlot | null = pickWeapon(e, t)): number {
  if (!slot) return 0;
  const d = slot.def;
  if (d.damage <= 0) return 0;
  const twin = e instanceof Unit && e.ut.twinShot && e.weapons[0] === slot ? 2 : 1;
  return Math.min(1000, d.damage * WARHEADS[d.warhead].verses[ARMOR_INDEX[t.type.armor]]) * d.burst * twin * (1 + 0.15 * e.rank) * (1 - 0.12 * t.rank);
}

function takeFocusSnapshot(world: World) {
  let s = snapshots.get(world);
  if (!s) snapshots.set(world, (s = { tick: -1, pledge: new Map(), hp: new Map(), mine: new Map() }));
  s.tick = world.tick;
  s.pledge.clear(); s.hp.clear(); s.mine.clear();
  const add = (e: Entity) => {
    const t = e.target;
    if (!t || !t.alive || t.kind === 'building' || !e.owner.isEnemy(t.owner)) return;
    const v = volley(e, t);
    s!.pledge.set(t.id, (s!.pledge.get(t.id) ?? 0) + v);
    s!.hp.set(t.id, t.hp);
    s!.mine.set(e.id, [t.id, v]);
  };
  for (const u of world.units) if (u.alive) add(u);
  for (const b of world.buildings) if (b.alive && b.target) add(b);
}

/** This tick's snapshot (none before the tick's pre-tick pass, e.g. right after loading: no bias then). */
function snapshot(world: World): FocusSnapshot | null {
  const s = snapshots.get(world);
  return s && s.tick === world.tick ? s : null;
}

/** While one side's fire is being redistributed: its running pledges (replace the snapshot's). */
let overlay: Map<number, number> | null = null;

/** Volleys others (not e) have on their way to c, and c's health, from the snapshot. */
function committed(s: FocusSnapshot, e: Entity, c: Entity): [number, number] {
  const hp = Math.max(1, s.hp.get(c.id) ?? c.hp);
  if (overlay) return [overlay.get(c.id) ?? 0, hp];
  const pl = s.pledge.get(c.id) ?? 0;
  const m = s.mine.get(e.id);
  return [pl - (m && m[0] === c.id ? m[1] : 0), hp];
}

/**
 * combat.findTarget hook: score adjustment (lower = preferred) for attacker e picking unit c. A target that
 * the volleys already on their way will kill is avoided (spread); one that this shot would finish is
 * preferred; partly committed ones attract a little (focus).
 */
export function focusBias(world: World, e: Entity, c: Unit, slot: WeaponSlot): number {
  if (!(e instanceof Unit)) return 0;
  const s = snapshot(world);
  if (!s) return 0;
  const [pl, hp] = committed(s, e, c);
  if (pl <= 0) return 0;
  if (pl >= hp * 1.1) return 3;
  if (pl + volley(e, c, slot) >= hp) return -1.2;
  return -0.5 * (pl / hp);
}

/** Units whose target is picked automatically (not an explicit attack order) and may be redistributed. */
function autoShooter(u: Unit): boolean {
  if (!u.alive || !u.weapons.length || u.stance === 'passive' || (u.kind !== 'infantry' && u.kind !== 'vehicle')) return false;
  const o = u.order;
  return o.type === 'idle' || o.type === 'guard' || o.type === 'escort' || (o.type === 'attack' && !o.forced && !!o.resume);
}

/**
 * Spread each side's fire (pre-tick, from the snapshot): per target, the nearest shooters whose volleys cover its
 * health keep it, the rest switch to other enemies in range, one by one with running pledges. Each player is
 * done separately from the start-of-tick state, so the result doesn't depend on update order or on which side
 * is processed first.
 */
function spreadFire(world: World, s: FocusSnapshot) {
  for (const p of world.players) {
    if (p.defeated) continue;
    const byTarget = new Map<number, Unit[]>();
    for (const u of world.units) {
      if (u.owner !== p || !autoShooter(u)) continue;
      const t = u.target;
      if (!(t instanceof Unit) || !t.alive || !p.isEnemy(t.owner)) continue;
      const list = byTarget.get(t.id);
      if (list) list.push(u); else byTarget.set(t.id, [u]);
    }
    if (byTarget.size === 0) continue;
    // volleys from everybody else (allies, defences) stay as they were
    const run = new Map<number, number>();
    for (const [tid, pl] of s.pledge) run.set(tid, pl);
    for (const list of byTarget.values()) for (const u of list) {
      const m = s.mine.get(u.id);
      if (m) run.set(m[0], (run.get(m[0]) ?? 0) - m[1]);
    }
    const excess: Unit[] = [];
    for (const [tid, list] of byTarget) {
      const t = world.entities.get(tid) as Unit;
      const hp = Math.max(1, s.hp.get(tid) ?? t.hp);
      list.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
      let acc = run.get(tid) ?? 0;
      for (const u of list) {
        if (acc >= hp * 1.1) { excess.push(u); continue; }
        acc += volley(u, t);
      }
      run.set(tid, acc);
    }
    if (!excess.length) continue;
    overlay = run;
    try {
      for (const u of excess) {
        const old = u.target as Unit;
        const alt = findTarget(world, u, maxRange(u), -1);
        const t = alt instanceof Unit && alt !== old ? alt : old;
        if (t !== old) {
          u.target = t;
          if (u.order.type === 'attack') u.order.target = t.id;
        }
        run.set(t.id, (run.get(t.id) ?? 0) + volley(u, t));
      }
    } finally {
      overlay = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Kiting
// ---------------------------------------------------------------------------

const KITE_ANGLES = [0, 0.6, -0.6, 1.2, -1.2];

/**
 * Back off from an enemy that is closing in on this unit but out-ranged by it (and can really hurt it): turreted
 * units keep shooting on the move, units that must stop to fire only step back while reloading (and only from
 * enemies they can outrun).
 */
function kite(world: World, u: Unit) {
  if (u.stance === 'hold' || u.stance === 'passive' || u.ut.harvester || u.ut.medic || u.ut.engineer) return;
  const t = u.target;
  if (!(t instanceof Unit) || !t.alive || t.isAir || t.kind === 'naval') return;
  // only from an enemy that is coming for this unit and can really hurt it (riflemen don't chase a tank off)
  if (t.target !== u) return;
  const mySlot = pickWeapon(u, t);
  const theirs = pickWeapon(t, u);
  if (!mySlot || !theirs || WARHEADS[theirs.def.warhead].verses[ARMOR_INDEX[u.type.armor]] < 0.5) return;
  const myRange = mySlot.def.range, tRange = theirs.def.range;
  // short-range attackers only (flamethrowers, rifles, dogs against rockets, Tanya, artillery): never tank against tank
  if (myRange < tRange + 1.5) return;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  const danger = Math.min(tRange + 1, myRange - 0.15);
  if (d > danger) return;
  const onTheMove = !!u.ut.turret && !u.ut.noMovingFire;
  if (!onTheMove) {
    if (speedOf(u) < speedOf(t) * 0.9) return;
    // stutter-step: shoot when ready and there is time to turn round and fire before it gets in range
    if (mySlot.cooldown <= 0.05) {
      const turn = Math.abs(angleDiff(u.heading, Math.atan2(t.y - u.y, t.x - u.x)));
      if (turn < 0.3) return;
      const rate = u.kind === 'infantry' ? 12 : rotToRadPerSecond(u.ut.rot);
      if (d - speedOf(t) * (turn / rate + 0.1) > tRange + 0.2) return;
    }
  }
  // don't kite away from what we are meant to hold
  const o = u.order;
  if (o.type === 'escort') {
    const g = world.entities.get(o.target);
    if (g && Math.hypot(g.x - u.x, g.y - u.y) > o.r + 5) return;
  } else if ((o.type === 'idle' || o.type === 'guard') && u.stance !== 'aggressive' && Math.hypot(u.guardX - u.x, u.guardY - u.y) > 7) return;
  const ax = (u.x - t.x) / (d || 1), ay = (u.y - t.y) / (d || 1);
  for (const a of KITE_ANGLES) {
    const c = Math.cos(a), s = Math.sin(a);
    const px = u.x + (ax * c - ay * s) * 1.6, py = u.y + (ax * s + ay * c) * 1.6;
    if (!clearLine(world, u.x, u.y, px, py)) continue;
    steerTo(u, px, py);
    u.speedCap = 0;
    return;
  }
}

