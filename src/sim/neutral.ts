/**
 * Neutral tech structures (Commander rules): oil derricks, field hospitals, radar outposts and
 * communications arrays, placed symmetrically by mapgen (`neutralSites`).
 *
 * They are ordinary Buildings owned by the neutral pseudo-player (`VarietyState.neutral`, id -1, not in
 * world.players, nobody's enemy: see Player.isEnemy), so they render, block, show on the minimap and keep their fog
 * memory like any structure. Any engineer that reaches one captures it at once (RA2 style), whoever holds it
 * (except allies); captured, it is the capturer's structure and can be attacked, recaptured or destroyed. A
 * destroyed one is rebuilt as neutral after a while; a defeated player's revert to neutral. Tech structures never
 * keep a player alive and don't extend the build area (world.ts checkVictory / isAdjacentToBase).
 *
 *   derrick   +$50 every 4 s to its owner
 *   hospital  heals the owner's (and allies') infantry within 5 cells by 5% a second
 *   radar     sight 13 and radar (rules.ts: handled by the regular visibility / economy code)
 *   comms     the owner's superweapons and support powers charge 10% faster; `commsBonus` for commander powers
 *
 * AI players value them: `aiNeutral` builds an engineer and sends it to the nearest site worth taking.
 * Deterministic: world state, own RNG in VarietyState, no Math.random.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import { Building, Unit } from './entities';
import type { Player } from './player';
import { SUPER_KINDS, superAvailable, superFull } from './superweapons';
import { recalcPlayerEconomy } from './production';
import { DT, TICK_HZ } from './types';
import { captureBuilding } from './unitlogic';
import type { World } from './world';
import type { VarietyState } from './events';

/** A tech structure's place on the map and the building standing there (0 = none, being rebuilt). */
export interface Site {
  type: string;
  cx: number;
  cy: number;
  id: number;
  /** Tick at which a destroyed site is rebuilt as neutral. */
  respawn: number;
}

export const DERRICK_INCOME = 50;
const DERRICK_EVERY = 4 * TICK_HZ;
const HOSPITAL_RADIUS = 5;
const HOSPITAL_RATE = 0.05;
const COMMS_BONUS = 0.1;
const RESPAWN = 90 * TICK_HZ;
/** Distance (cells) from a footprint edge at which an engineer takes the structure. */
export const CAPTURE_REACH = 0.95;

export function isTech(b: Building): boolean {
  return !!b.bt.tech;
}

/** Spawn the neutral building of a site (if its footprint is clear). */
export function raiseSite(w: World, v: VarietyState, s: Site): boolean {
  const bt = BUILDINGS[s.type];
  if (!bt) return false;
  const m = w.map;
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
    const x = s.cx + dx, y = s.cy + dy;
    if (!m.inBounds(x, y) || !m.terrainPassable(m.idx(x, y)) || m.occupant[m.idx(x, y)]) return false;
  }
  // no unit may stand inside the footprint
  for (const u of w.units) {
    if (u.alive && !u.isAir && u.x >= s.cx - 0.2 && u.x < s.cx + bt.size[0] + 0.2 && u.y >= s.cy - 0.2 && u.y < s.cy + bt.size[1] + 0.2) return false;
  }
  const b = w.addBuilding(s.type, v.neutral, s.cx, s.cy, true);
  s.id = b.id;
  s.respawn = 0;
  w.events.push({ e: 'placed', id: b.id });
  return true;
}

/** Hand a tech structure to `to` (capture without an engineer: reverting to neutral). */
function transfer(w: World, b: Building, to: Player) {
  const old = b.owner;
  if (old === to) return;
  if (b.counted) {
    old.owned.set(b.bt.id, Math.max(0, (old.owned.get(b.bt.id) ?? 1) - 1));
    to.owned.set(b.bt.id, (to.owned.get(b.bt.id) ?? 0) + 1);
  }
  b.owner = to;
  b.repairing = false;
  b.target = null;
  w.events.push({ e: 'captured', id: b.id, from: old.id, to: to.id });
  if (old.id >= 0) recalcPlayerEconomy(w, old);
  if (to.id >= 0) recalcPlayerEconomy(w, to);
}

/** Owners' shares of the tech structures (UI / tests). */
export function techOwned(w: World, p: Player): Building[] {
  return w.buildings.filter((b) => b.alive && b.bt.tech && b.owner === p);
}

/** Extra charge rate the player's communications arrays give its powers (0 or 0.1); commander powers may read it. */
export function commsBonus(w: World, p: Player): number {
  for (const b of w.buildings) if (b.alive && b.owner === p && b.bt.tech === 'comms') return COMMS_BONUS;
  return 0;
}

/** Extra power charge: Communications Array, Lightning War (charge = extra rate, 1 = twice as fast). */
export function chargePowers(w: World, p: Player, extra: number, seconds: number) {
  if (extra <= 0 || p.defeated || p.lowPower) return;
  for (const k of SUPER_KINDS) {
    if (k === 'sonar' || !superAvailable(w, p, k)) continue;
    const full = superFull(w, p, k);
    if (p.superCharge[k] < full) p.superCharge[k] = Math.min(full, p.superCharge[k] + extra * seconds);
  }
}

/** Per tick (Commander rules): captures, income, healing, power charge, rebuilding and reverting. */
export function neutralTick(w: World, v: VarietyState) {
  const t = w.tick;
  if (t % 5 === 0) captures(w, v);
  if (t % DERRICK_EVERY === 0) {
    for (const b of w.buildings) {
      if (!b.alive || b.bt.tech !== 'derrick' || b.owner.id < 0 || b.owner.defeated) continue;
      b.owner.cash += DERRICK_INCOME;
      w.events.push({ e: 'credits', player: b.owner.id, amount: DERRICK_INCOME, x: b.x, y: b.y });
    }
  }
  if (t % 20 === 10) {
    for (const b of w.buildings) {
      if (!b.alive || b.bt.tech !== 'hospital' || b.owner.id < 0) continue;
      let healed = false;
      w.grid.query(b.x, b.y, HOSPITAL_RADIUS + 1, (u) => {
        if (!u.alive || u.kind !== 'infantry' || u.owner.isEnemy(b.owner) || u.owner.id < 0 || u.hp >= u.maxHp) return;
        if (Math.hypot(u.x - b.x, u.y - b.y) > HOSPITAL_RADIUS) return;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * HOSPITAL_RATE);
        healed = true;
      });
      if (healed && t % 80 === 10) w.sfx('heal', b.x, b.y);
    }
  }
  if (t % 10 === 0) {
    for (const p of w.players) {
      const extra = commsBonus(w, p);
      if (!extra) continue;
      chargePowers(w, p, extra, 10 * DT);
      // commander powers recharge 10% faster too: one tick off every pending cooldown per 10 ticks
      const c = p.cmd;
      if (c) for (const id of c.unlocked) if ((c.ready[id] ?? 0) > t) c.ready[id] -= Math.round(10 * extra);
    }
  }
  if (t % TICK_HZ === 7) sites(w, v);
  // a pointer for newcomers, once the opening has settled
  if (t === 40 * TICK_HZ && v.sites.length) {
    const s = v.sites.find((x) => x.type === 'oild') ?? v.sites[0];
    news(w, v, 'Neutral tech structures', 'Oil derricks, field hospitals, radar outposts and communications arrays stand on the map. Send an Engineer to one to capture it (any engineer can take it back).', s.cx + 1, s.cy + 1, -1, 'site');
  }
}

function captures(w: World, v: VarietyState) {
  let any = false;
  for (const b of w.buildings) if (b.alive && b.bt.tech) { any = true; break; }
  if (!any) return;
  for (const u of w.units) {
    if (!u.alive || !u.ut.engineer || u.transport || u.owner.id < 0) continue;
    for (const b of w.buildings) {
      if (!b.alive || !b.bt.tech || b.owner === u.owner) continue;
      if (b.owner.id >= 0 && !u.owner.isEnemy(b.owner)) continue;
      if (b.distTo(u.x, u.y) > CAPTURE_REACH) continue;
      const from = b.owner;
      captureBuilding(w, b, u);
      w.kill(u, 'sold'); // the engineer goes in
      v.captures++;
      news(w, v, from.id < 0 ? 'Tech structure captured' : 'Tech structure seized', `${u.owner.name} took the ${b.bt.name}${from.id >= 0 ? ` from ${from.name}` : ''}.`, b.x, b.y, u.owner.id, 'site');
      break;
    }
  }
}

function sites(w: World, v: VarietyState) {
  for (const s of v.sites) {
    const b = s.id ? w.entities.get(s.id) : undefined;
    if (b instanceof Building && b.alive) {
      // a defeated commander's tech structures go back to neutral
      if (b.owner.id >= 0 && b.owner.defeated) transfer(w, b, v.neutral);
      continue;
    }
    if (s.id) { s.id = 0; s.respawn = w.tick + RESPAWN; }
    if (s.respawn && w.tick >= s.respawn) raiseSite(w, v, s);
  }
}

// =====================================================================================================
// AI: take the tech structures (engineers), driven from the variety tick (no hooks in ai*.ts needed)
// =====================================================================================================

/** One AI's engineer run: the engineer (0 = none yet) and the building it is sent to. */
export interface AiCapture {
  player: number;
  engineer: number;
  target: number;
  since: number;
  /** Earliest tick for the next attempt. */
  next: number;
}

function aiTask(v: VarietyState, p: Player): AiCapture {
  let t = v.aiCaps.find((c) => c.player === p.id);
  if (!t) { t = { player: p.id, engineer: 0, target: 0, since: 0, next: 0 }; v.aiCaps.push(t); }
  return t;
}

/** Every 5 s per AI (staggered): pick a tech structure worth taking and send an engineer. */
export function aiNeutral(w: World, v: VarietyState) {
  for (let k = 0; k < w.ais.length; k++) {
    if ((w.tick + k * 17) % (5 * TICK_HZ) !== 0) continue;
    const ai = w.ais[k];
    const p = ai.player;
    if (p.defeated || ai.behaviour !== 'full' || ai.d.neutral === false) continue; // (recruit and easy leave the derricks alone)
    const task = aiTask(v, p);
    const eng = task.engineer ? w.entities.get(task.engineer) : undefined;
    const target = task.target ? w.entities.get(task.target) : undefined;
    const targetOk = target instanceof Building && target.alive && target.bt.tech && target.owner !== p && (target.owner.id < 0 || p.isEnemy(target.owner));
    if (eng instanceof Unit && eng.alive) {
      if (!targetOk) {
        task.target = pickTarget(w, ai.baseCenter(), p)?.id ?? 0;
        if (!task.target) continue;
      }
      const b = w.entities.get(task.target) as Building;
      // walk to the side of the footprint nearest to the engineer, again whenever it stops short
      if (eng.order.type === 'idle' || w.tick - task.since > 40 * TICK_HZ) {
        const [px, py] = b.closestPoint(eng.x, eng.y);
        const [fx, fy] = w.findFreeSpot(px + Math.sign(eng.x - px) * 0.6, py + Math.sign(eng.y - py) * 0.6, 3, false);
        w.issue({ c: 'move', player: p.id, units: [eng.id], x: fx, y: fy });
        task.since = w.tick;
      }
      continue;
    }
    task.engineer = 0;
    if (w.tick < task.next) continue;
    // late and cautious on easy, early on brutal
    const skill = ai.d.skill;
    if (w.time < 150 - skill * 90) continue;
    if (ai.ceasefire && skill < 0.5) continue;
    const pick = pickTarget(w, ai.baseCenter(), p);
    if (!pick) continue;
    task.target = pick.id;
    // an idle engineer of ours, or train one
    const idle = w.units.find((u) => u.alive && u.owner === p && u.ut.engineer && !u.transport && u.order.type === 'idle');
    if (idle) { task.engineer = idle.id; task.since = w.tick - 41 * TICK_HZ; continue; }
    const q = p.queues.infantry;
    if (q.items.some((it) => it.type === 'e6')) continue;
    if (!p.canBuild('e6') || p.credits < UNITS.e6.cost + 600 || q.items.length > 3) continue;
    w.issue({ c: 'build', player: p.id, type: 'e6' });
    task.next = w.tick + (40 - skill * 20) * TICK_HZ;
  }
  // adopt freshly trained engineers
  for (const task of v.aiCaps) {
    if (task.engineer || !task.target) continue;
    const p = w.players[task.player];
    const fresh = w.units.find((u) => u.alive && u.owner === p && u.ut.engineer && !u.transport && u.order.type === 'idle');
    if (fresh) { task.engineer = fresh.id; task.since = w.tick - 41 * TICK_HZ; }
  }
}

/** The nearest tech structure `p` could take from home (neutral first, then enemy-held), or null. */
function pickTarget(w: World, home: [number, number], p: Player): Building | null {
  let best: Building | null = null, bestScore = Infinity;
  const reach = w.map.w * 0.75;
  for (const b of w.buildings) {
    if (!b.alive || !b.bt.tech || b.owner === p) continue;
    if (b.owner.id >= 0 && !p.isEnemy(b.owner)) continue;
    const d = Math.hypot(b.x - home[0], b.y - home[1]);
    if (d > reach) continue;
    // enemy-held ones are worth it too, but are usually guarded: a neutral one a bit further away comes first
    const value = b.bt.tech === 'derrick' ? 1 : b.bt.tech === 'radar' ? 0.9 : 0.8;
    const score = (d + (b.owner.id >= 0 ? 18 : 0)) / value;
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/** A short announcement for the UI (see VarietyState.news). */
export function news(w: World, v: VarietyState, title: string, text: string, x: number, y: number, player = -1, kind: 'site' | 'event' | 'dyn' = 'event', extra: { event?: number; phase?: string } = {}) {
  v.newsSeq++;
  v.news.push({ seq: v.newsSeq, tick: w.tick, kind, title, text, x, y, player, ...extra });
  if (v.news.length > 16) v.news.splice(0, v.news.length - 16);
}
