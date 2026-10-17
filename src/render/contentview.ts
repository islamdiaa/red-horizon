/**
 * How the local player perceives naval, stealth and deception content: what is visible at all (fog + cloak + detection),
 * which model an enemy sees (decoys look real, a disguised spy looks like a rifleman) and the extra
 * animation inputs (submarine dive, parachutes, deploy ramps/dishes, own-cloak shimmer).
 * Pure helpers so the entity renderer only needs a few calls.
 */
import { Building, Unit, type Entity } from '../sim/entities';
import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { apparentType, disguisedAs } from '../sim/infiltration';
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

/**
 * Fill the content-specific animation inputs for one entity. Targets only: the models ease them
 * (dive ~1.3 s, canopy open/collapse, ramp and dish spin-up).
 */
export function contentAnim(e: Entity, viewer: Player, anim: ModelAnimState) {
  if (e instanceof Unit) {
    if (e.ut.cloakable) anim.submerged = e.submerged && e.surfacing <= 0 ? 1 : 0;
    anim.parachute = e.parachute > 0 ? 1 : 0;
    // Aftermath: M.A.D. tank rig / ram, chrono tank emitter recharge, demolition truck arming light
    if (e.ut.quake) { anim.deployed = e.madStage > 0 ? 1 : 0; anim.charge = e.madCharge; }
    else if (e.ut.chronoShift) anim.charge = 1 - e.chronoCooldown / e.ut.chronoShift;
    else if (e.ut.demolition) anim.charge = e.armed ? 0.75 : 0;
    if (e.ut.gapRadius || e.ut.jamRadius) anim.deployed = e.moving ? 0.3 : 1;
    else if (e.ut.id === 'lst') anim.deployed = e.ramp;
    else if (e.ut.id === 'tran') anim.deployed = (e.altitude ?? 1) < 0.05 && e.passengers.length < (e.ut.passengers ?? 0) ? 1 : 0;
  }
  // own cloaked things shimmer so the owner can tell they are hidden from the enemy
  anim.cloak = e.cloaked && e.owner.team === viewer.team ? 1 : 0;
}
