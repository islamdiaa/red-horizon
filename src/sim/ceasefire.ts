/**
 * Skirmish "Build-up time" (a ceasefire at the start of the match).
 *
 * While it lasts no AI player strikes first: no attack waves, raids, harassment, superweapon launches, offensive
 * support powers, naval raids, infiltrations or air strikes (see the `ceasefireActive` gates in ai.ts, ai-ops.ts,
 * ai-naval.ts, ai-content.ts and aftermath.ts), and AI units only open fire by themselves on what is inside their
 * own (or an ally's) base area or on whoever is shooting at their side (`mayAutoEngage`, used by the unit target
 * search in combat.ts and by crushing in unitlogic.ts). The AI keeps building its economy, defences and army, and
 * always defends. Humans are never restricted, and attacking the AI does not end a timed ceasefire early.
 *
 * World.ceasefireUntil holds the state: 0 = off, CEASEFIRE_UNLIMITED = for the whole match (sandbox), otherwise the
 * tick at which it ends. It is part of the saved world (save.ts) and comes from GameSetup.ceasefire, which replays
 * carry in their setup. Everything here is derived from the world, so it is deterministic.
 */
import type { Entity } from './entities';
import type { Player } from './player';
import { TICK_HZ } from './types';
import type { World } from './world';

/** World.ceasefireUntil for a ceasefire that never ends. */
export const CEASEFIRE_UNLIMITED = -1;

/** Choices offered in the skirmish setup, in minutes (0 = off, -1 = unlimited). */
export const CEASEFIRE_CHOICES = [0, 5, 10, 15, 20, 30, -1] as const;

/** Seconds before the end of a timed ceasefire when the "enemy forces are mobilising" warning goes out. */
export const CEASEFIRE_WARNING = 60;

/** Cells around a player's (or an ally's) structures that count as its base area. */
export const HOME_RADIUS = 10;

/** Whether the ceasefire holds at the current tick. */
export function ceasefireActive(w: Pick<World, 'ceasefireUntil' | 'tick'>): boolean {
  const t = w.ceasefireUntil;
  return t === CEASEFIRE_UNLIMITED || (t > 0 && w.tick < t);
}

/** Seconds left of a timed ceasefire (Infinity when unlimited, 0 when off or over). */
export function ceasefireLeft(w: Pick<World, 'ceasefireUntil' | 'tick'>): number {
  const t = w.ceasefireUntil;
  if (t === CEASEFIRE_UNLIMITED) return Infinity;
  return t > w.tick ? (t - w.tick) / TICK_HZ : 0;
}

/** World.ceasefireUntil for a setup value in minutes (0 / undefined = off, negative = unlimited). */
export function ceasefireTicks(minutes: number | undefined): number {
  if (typeof minutes !== 'number' || !minutes || Number.isNaN(minutes)) return 0;
  if (minutes < 0 || minutes === Infinity) return CEASEFIRE_UNLIMITED;
  return Math.max(1, Math.round(minutes * 60 * TICK_HZ));
}

/**
 * The ceasefire a match setup asks for, in World.ceasefireUntil terms. Skirmish only: missions, campaigns,
 * Conquest, challenges, King of the Hill and the menu backdrop never have one.
 */
export function ceasefireForSetup(
  setup: { ceasefire?: number; koth?: boolean; challenge?: unknown; mission?: string; conquest?: unknown; demo?: boolean },
  isMission: boolean,
): number {
  if (isMission || setup.demo || setup.koth || setup.challenge || setup.mission || setup.conquest) return 0;
  return ceasefireTicks(setup.ceasefire);
}

/** Display label for a choice in minutes. */
export function ceasefireLabel(minutes: number | undefined): string {
  if (!minutes) return 'Off';
  return minutes < 0 ? 'Unlimited' : `${minutes} min`;
}

/** Whether (x, y) lies within HOME_RADIUS of a structure of `p` or of one of its allies (its start, before it has any). */
export function inHomeArea(w: World, p: Player, x: number, y: number): boolean {
  let any = false;
  for (const b of w.buildings) {
    if (!b.alive || b.bt.mine || p.isEnemy(b.owner)) continue;
    if (b.owner === p) any = true;
    if (b.distTo(x, y) <= HOME_RADIUS) return true;
  }
  if (any) return false;
  const s = w.map.startPositions[p.id % Math.max(1, w.map.startPositions.length)];
  return !!s && Math.hypot(s.x - x, s.y - y) <= HOME_RADIUS;
}

/** What `t` is fighting of `side` (or of its allies): its current target or the target of its attack order. */
export function hostileTarget(w: World, side: Player, t: Entity): Entity | null {
  const cur = t.target;
  if (cur && cur.alive && !side.isEnemy(cur.owner)) return cur;
  const o = (t as { order?: { type: string; target?: number } }).order;
  if (o && o.type === 'attack' && o.target) {
    const e = w.entities.get(o.target);
    if (e && e.alive && !side.isEnemy(e.owner)) return e;
  }
  return null;
}

/** Whether `t` is fighting `side` (or its allies). */
export function hostileTo(w: World, side: Player, t: Entity): boolean {
  return !!hostileTarget(w, side, t);
}

/**
 * Whether `attacker` may engage `t` of its own accord (target search, crushing). Always true outside a ceasefire
 * and for humans; an AI under the ceasefire only takes on intruders in its base area and whoever attacks its side
 * (harvesters going about their work are left alone).
 */
export function mayAutoEngage(w: World, attacker: Entity, t: Entity): boolean {
  if (attacker.owner.isHuman || !ceasefireActive(w)) return true;
  if (hostileTo(w, attacker.owner, t)) return true;
  if (attacker.lastAttacker === t.id && w.tick - attacker.lastDamagedTick < TICK_HZ * 10) return true;
  if ((t as { ut?: { harvester?: boolean } }).ut?.harvester) return false;
  return inHomeArea(w, attacker.owner, t.x, t.y);
}
