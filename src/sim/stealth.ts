/**
 * Stealth & electronic warfare for land/air content:
 * - mines and the Camo Pillbox are `cloaked` (Entity.cloaked / revealedTo, the World.canSee rule shared with
 *   submarines): enemies only see them when one of their units is right next to them (or the pillbox fires);
 * - gap generators (structure `gap`, RA GapRadius 10, needs full power; Mobile Gap Generator `mgg`, radius 3)
 *   keep the cells around them shrouded for every enemy: their `visible` and `explored` are cleared there
 *   on every visibility pass, except what enemy units standing inside the field see themselves;
 * - Mobile Radar Jammers (`mrj`, RA RadarJamRadius 10) jam enemy radar domes and SAM sites in range
 *   (BUILDING.CPP: IsJammed radar gives no radar, a jammed SAM can't fire);
 * - targeting filters: disguised spies (except for dogs), paratroopers still under their chute and mines are
 *   never picked automatically.
 */
import { Building, Unit, type Entity } from './entities';
import type { Player } from './player';
import { recalcPlayerEconomy } from './production';
import { TICK_HZ } from './types';
import type { World } from './world';

/** A Camo Pillbox stays visible this long after its last shot. */
const CAMO_REVEAL_TICKS = TICK_HZ * 3;
/** Enemies see a mine from this close (cells, centre to centre) and a camo pillbox from this close to its edge. */
const MINE_DETECT = 1.5;
const CAMO_DETECT = 1.5;

/** Whether `attacker` may pick `t` as a target on its own (auto-targeting, retaliation scans). */
export function autoTargetable(attacker: Entity, t: Entity): boolean {
  if (t instanceof Unit) {
    if (t.parachute > 0) return false;
    // a disguised spy looks like one of ours: only dogs sniff it out (RA)
    if (t.ut.spy && t.disguise >= 0 && !(attacker instanceof Unit && attacker.ut.dog)) return false;
    return true;
  }
  return !(t instanceof Building && t.bt.mine);
}

/** Bitmask of every player on the given player's team (who share what that player's units detect). */
function teamMask(world: World, p: Player): number {
  let m = 0;
  for (const o of world.players) if (o.team === p.team) m |= 1 << o.id;
  return m;
}

/** Refresh cloak state of mines and camo pillboxes (every visibility pass). */
export function updateCloaks(world: World) {
  for (const b of world.buildings) {
    if (!b.alive) continue;
    if (b.bt.mine) {
      b.cloaked = true;
      const mask = detectMask(world, b, MINE_DETECT);
      const fresh = mask & ~b.revealedTo;
      b.revealedTo = mask;
      // a unit of yours just stumbled on an enemy mine
      if (fresh) for (const p of world.players) if (fresh & (1 << p.id)) world.announce(p, 'mine_detected', 10);
    } else if (b.bt.camo) {
      b.cloaked = world.tick - b.lastFireTick > CAMO_REVEAL_TICKS;
      b.revealedTo = b.cloaked ? detectMask(world, b, CAMO_DETECT) : 0;
    }
  }
}

function detectMask(world: World, b: Building, r: number): number {
  let mask = 0;
  world.grid.query(b.x, b.y, r + b.w / 2 + 0.5, (u) => {
    if (!u.alive || u.isAir || u.parachute > 0 || !u.owner.isEnemy(b.owner)) return;
    if ((mask & (1 << u.owner.id)) !== 0) return;
    const d = b.bt.mine ? Math.hypot(u.x - b.x, u.y - b.y) : b.distTo(u.x, u.y);
    if (d <= r) mask |= teamMask(world, u.owner);
  });
  return mask;
}

// ---------------------------------------------------------------------------
// Gap generators
// ---------------------------------------------------------------------------

interface GapField { x: number; y: number; r: number; owner: Player }

/** Fields are gathered once per tick (every player's visibility pass of that tick shares them). */
const fieldCache = new WeakMap<World, { tick: number; n: number; fields: GapField[] }>();

function gapFields(world: World): GapField[] {
  const n = world.units.length * 65536 + world.buildings.length;
  const c = fieldCache.get(world);
  if (c && c.tick === world.tick && c.n === n) return c.fields;
  const out: GapField[] = [];
  for (const b of world.buildings) {
    // RA: a gap generator only jams at full power
    if (b.alive && b.bt.gapRadius && b.active && !b.owner.lowPower) out.push({ x: b.x, y: b.y, r: b.bt.gapRadius, owner: b.owner });
  }
  for (const u of world.units) {
    if (u.alive && u.ut.gapRadius && !u.transport) out.push({ x: u.x, y: u.y, r: u.ut.gapRadius, owner: u.owner });
  }
  fieldCache.set(world, { tick: world.tick, n, fields: out });
  return out;
}

/**
 * Re-shroud enemy gap fields for player p (World.updateVisibility hook, after p's own sight stamp).
 * Units and structures of p's team standing inside a field still see around themselves.
 */
export function applyGapShroud(world: World, p: Player) {
  let fields: GapField[] | null = null;
  for (const f of gapFields(world)) {
    if (f.owner.team === p.team) continue;
    (fields ??= []).push(f);
  }
  if (!fields) return;
  const m = world.map;
  for (const f of fields) {
    const fx = Math.floor(f.x), fy = Math.floor(f.y), R = Math.ceil(f.r);
    const r2 = f.r * f.r + 0.5;
    for (let dy = -R; dy <= R; dy++) {
      const cy = fy + dy;
      if (cy < 0 || cy >= m.h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const cx = fx + dx;
        if (cx < 0 || cx >= m.w || dx * dx + dy * dy > r2) continue;
        const i = cy * m.w + cx;
        p.visible[i] = 0;
        // a GPS satellite keeps the map charted; it can't see into the field though
        if (!p.gps) p.explored[i] = 0;
      }
    }
  }
  // own eyes inside a field
  const inside = (x: number, y: number) => fields!.some((f) => Math.hypot(x - f.x, y - f.y) <= f.r + 0.5);
  for (const u of world.units) {
    if (u.alive && u.owner.team === p.team && inside(u.x, u.y)) stamp(world, p, u.x, u.y, u.ut.sight + 0.5);
  }
  for (const b of world.buildings) {
    if (b.alive && b.owner.team === p.team && inside(b.x, b.y)) stamp(world, p, b.x, b.y, b.bt.sight + Math.max(b.w, b.h) / 2);
  }
}

function stamp(world: World, p: Player, x: number, y: number, r: number) {
  const m = world.map;
  const fx = Math.floor(x), fy = Math.floor(y), R = Math.ceil(r);
  const r2 = r * r + 0.5;
  for (let dy = -R; dy <= R; dy++) {
    const cy = fy + dy;
    if (cy < 0 || cy >= m.h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const cx = fx + dx;
      if (cx < 0 || cx >= m.w || dx * dx + dy * dy > r2) continue;
      const i = cy * m.w + cx;
      p.visible[i] = 1;
      p.explored[i] = 1;
    }
  }
}

/** Whether cell (x, y) lies in an active gap field hostile to p (for UI / AI queries). */
export function inEnemyGap(world: World, p: Player, x: number, y: number): boolean {
  for (const f of gapFields(world)) if (f.owner.team !== p.team && Math.hypot(x - f.x, y - f.y) <= f.r) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Radar jamming
// ---------------------------------------------------------------------------

/** Every second: radar domes and SAM sites near an enemy jammer are jammed (RA BUILDING.CPP AI). */
export function updateJamming(world: World) {
  let jammers: Unit[] | null = null;
  for (const u of world.units) if (u.alive && u.ut.jamRadius && !u.transport) (jammers ??= []).push(u);
  let changed: Player[] | null = null;
  for (const b of world.buildings) {
    if (!b.alive || !(b.bt.radar || b.bt.id === 'sam')) continue;
    let jam = false;
    if (jammers) for (const j of jammers) {
      if (j.owner.isEnemy(b.owner) && b.distTo(j.x, j.y) <= j.ut.jamRadius!) { jam = true; break; }
    }
    if (jam === b.jammed) continue;
    b.jammed = jam;
    if (jam) {
      world.sfx('jammer', b.x, b.y);
      if (b.bt.radar) world.announce(b.owner, 'radar_jammed', 6);
    }
    if (b.bt.radar) (changed ??= []).includes(b.owner) || changed.push(b.owner);
  }
  if (changed) for (const p of changed) recalcPlayerEconomy(world, p);
}
