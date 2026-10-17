/**
 * [ARMY] Repeat production ("loop"): a unit type switched on at a factory keeps being built while money allows.
 *
 * Red Alert builds one item per production strip; Red Horizon queues up to QUEUE_LIMIT, and a loop keeps one
 * copy of each looped type in its queue. The next copy is only queued once the player can pay for all of it, so
 * a loop waits quietly on low funds (no partial payments, no "insufficient funds" nagging) and resumes on its
 * own when money comes in. Units come out of the primary factory and build slower on low power, exactly like
 * hand-queued ones; several loops in one queue take turns.
 *
 * State: Player.repeat (type ids in the order they were switched on; plain JSON, so saves carry it). The
 * `repeat` command is recorded like any other, so replays stay in sync. Deterministic: no RNG, runs inside
 * updateProduction. The AI never loops.
 */
import { UNITS } from '../data/rules';
import { Building } from './entities';
import { queueKindOf, type Player } from './player';
import { QUEUE_LIMIT, factoriesFor } from './production';
import { costOf } from './doctrine'; // [DOCTRINE] doctrine prices (= cost under Classic rules)
import type { Command } from './types';
import type { World } from './world';

/** Most loops a player can run at once (a bound on saved state; far more than five queues need). */
export const MAX_LOOPS = 16;

/** Whether a unit type can be looped at all (units only: structures need placing). */
export function loopable(type: string): boolean {
  return !!UNITS[type] && UNITS[type].buildable !== false;
}

/** The factory a loop command should name for a type: the primary one, else the first that builds it. */
export function loopFactory(world: World, p: Player, type: string): Building | null {
  if (!loopable(type)) return null;
  const facs = factoriesFor(world, p, type);
  return facs.find((b) => b.primary) ?? facs[0] ?? null;
}

/** Is this type looping for the player? */
export function isLooping(p: Player, type: string): boolean {
  return p.repeat.includes(type);
}

/**
 * The `repeat` command: switch a loop on (the factory must be the player's own, finished, and able to build the
 * type) or off (always allowed, also for a factory that is gone).
 */
export function repeatCommand(world: World, p: Player, cmd: Extract<Command, { c: 'repeat' }>) {
  const i = p.repeat.indexOf(cmd.type);
  if (!cmd.on) {
    if (i >= 0) p.repeat.splice(i, 1);
    return;
  }
  if (i >= 0 || !loopable(cmd.type) || p.repeat.length >= MAX_LOOPS || !p.canBuild(cmd.type)) return;
  const b = world.entities.get(cmd.building);
  if (!(b instanceof Building) || b.owner !== p || !b.alive || !factoriesFor(world, p, cmd.type).includes(b)) return;
  p.repeat.push(cmd.type);
}

/**
 * Called by updateProduction at the end of every tick, after the queues advanced: drop loops whose type can't be
 * built any more (factory or tech lost, like the queue itself drops such items), and queue the next copy of each
 * looped type that has none queued, when the queue has room and the player can pay for it in full. (So between
 * ticks a looping queue is only ever empty while it waits for money.)
 */
export function updateRepeat(world: World, p: Player) {
  const list = p.repeat;
  if (!list.length) return;
  for (let k = 0; k < list.length; k++) {
    const type = list[k];
    if (!p.canBuild(type)) {
      list.splice(k--, 1);
      continue;
    }
    const t = UNITS[type];
    const q = p.queues[queueKindOf(t)];
    if (q.items.length >= QUEUE_LIMIT || q.count(type) > 0 || p.credits < costOf(p, t)) continue;
    q.items.push({ type, progress: 0, paid: 0, paused: false });
  }
}
