/**
 * How the local player perceives the round-4 content: what is visible at all (fog + cloak + detection),
 * which model an enemy sees (decoys look real, a disguised spy looks like a rifleman) and the extra
 * animation inputs (submarine dive, parachutes, deploy ramps/dishes, own-cloak shimmer).
 * Pure helpers so the entity renderer only needs a few calls.
 */
import { Building, Unit, type Entity } from '../sim/entities';
import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { apparentType, disguisedAs } from '../sim/infiltration';
import { PARACHUTE_SECONDS } from '../sim/powers';
import type { ModelAnimState } from './models/types';

/** Cloaked enemies (submerged subs, mines, camo pillboxes) stay hidden unless the sim says we detect them. */
export function cloakHidden(world: World, viewer: Player, e: Entity): boolean {
  return e.cloaked && e.owner.team !== viewer.team && !world.canSee(viewer, e);
}

/** The type id and owner a viewer believes an entity to be (decoys and disguised spies lie to enemies). */
export function perceived(world: World, viewer: Player, e: Entity): { type: string; owner: Player } {
  if (e instanceof Building) return { type: apparentType(e, viewer).id, owner: e.owner };
  if (e instanceof Unit && e.disguise >= 0) {
    const d = disguisedAs(world, e, viewer);
    if (d) return d;
  }
  return { type: e.type.id, owner: e.owner };
}

const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, dt * rate);

/** Fill the content-specific animation inputs for one entity (eased so models move smoothly). */
export function contentAnim(e: Entity, viewer: Player, anim: ModelAnimState, dt: number) {
  if (e instanceof Unit) {
    anim.submerged = ease(anim.submerged ?? 0, e.submerged && e.surfacing <= 0 ? 1 : 0, 1.4, dt);
    anim.parachute = e.parachute > 0 ? Math.min(1, e.parachute / PARACHUTE_SECONDS + 0.25) : ease(anim.parachute ?? 0, 0, 3, dt);
    const dish = e.ut.gapRadius || e.ut.jamRadius ? 1 : 0;
    anim.deployed = ease(anim.deployed ?? 0, Math.max(dish, e.ramp ?? 0), 2, dt);
  }
  // own cloaked things shimmer so the owner can tell they are hidden from the enemy
  anim.cloak = ease(anim.cloak ?? 0, e.cloaked && e.owner.team === viewer.team ? 1 : 0, 2, dt);
}
