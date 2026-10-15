/**
 * Per-tick entry points for the land/air content (spies, mines, gap generators, jammers, support powers,
 * paratroopers, bridges). World.step / updateVisibility call these through one-line hooks.
 */
import type { Unit } from './entities';
import type { Player } from './player';
import { TICK_HZ } from './types';
import type { World } from './world';
import { updateDisguises, updateIntel } from './infiltration';
import { updateMines, updateRearm } from './mines';
import { applyGapShroud, updateCloaks, updateJamming } from './stealth';
import { powerVisibility, updateParachute, updatePowerTimers } from './powers';

/** Before buildings and units update (after production / superweapon charging). */
export function contentPreTick(world: World) {
  updatePowerTimers(world);
  if (world.tick % TICK_HZ === 0) {
    updateJamming(world);
    updateIntel(world);
    updateDisguises(world);
  }
  updateRearm(world);
}

/** After units moved (still inside the combat phase: deaths are deferred). */
export function contentPostMove(world: World) {
  updateMines(world);
  // cloak state is refreshed right before each visibility pass
  if (world.tick % 4 === 0) updateCloaks(world);
}

/** End of World.updateVisibility(p) (fog on): gap shroud, spy-plane photos, GPS snapshot, sonar. */
export function contentVisibility(world: World, p: Player) {
  applyGapShroud(world, p);
  powerVisibility(world, p);
}

/** World.stepUnit hook: true when the unit is busy with something that replaces its normal update. */
export function contentStepUnit(world: World, u: Unit): boolean {
  if (u.parachute > 0) {
    updateParachute(world, u);
    return true;
  }
  return false;
}
