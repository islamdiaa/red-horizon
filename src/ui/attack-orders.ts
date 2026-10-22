/**
 * The commands behind the two ways of ordering an attack with the mouse (DOM-free, so tests can run them through
 * the simulation; src/ui/input.ts issues them):
 *  - a right-click on an enemy: an attack order for every unit that can hurt it, an attack-move there for the rest
 *    (rifles against aircraft, medics...), who would otherwise get no order at all;
 *  - an attack-move click (A, then click), also when the click lands on an enemy structure or unit: everyone
 *    attack-moves to that point and fights what it meets on the way, then takes on what is there. (An attack order
 *    here walked the army past every defence on the way, getting it shot without firing back.)
 */
import { pickWeapon } from '../sim/combat';
import { Building, type Entity, type Unit } from '../sim/entities';
import type { Command } from '../sim/types';

/** Can this unit do anything to the target (shoot it, or enter it as an engineer, saboteur, spy or thief)? */
export function canEngage(u: Unit, t: Entity): boolean {
  if (t instanceof Building && (u.ut.engineer || u.ut.c4 || u.ut.spy || u.ut.thief)) return true;
  return u.weapons.length > 0 && !u.ut.medic && !!pickWeapon(u, t);
}

/** Right-click on an enemy: attack it with whoever can; the others attack-move to it. */
export function attackCommands(player: number, units: readonly Unit[], t: Entity): Command[] {
  const able = units.filter((u) => canEngage(u, t)).map((u) => u.id);
  const rest = units.filter((u) => !canEngage(u, t)).map((u) => u.id);
  const out: Command[] = [];
  if (able.length) out.push({ c: 'attack', player, units: able, target: t.id });
  if (rest.length) out.push({ c: 'move', player, units: rest, x: t.x, y: t.y, attackMove: true });
  return out;
}

/**
 * Attack-move click at a ground point, or on an enemy (`target`, already checked to be an enemy by the caller):
 * the whole selection attack-moves there. Returns the command and the point it goes to.
 */
export function attackMoveCommands(player: number, units: readonly Unit[], target: Entity | null, gx: number, gy: number, queue = false): { cmds: Command[]; x: number; y: number } {
  const x = target ? target.x : gx, y = target ? target.y : gy;
  if (!units.length) return { cmds: [], x, y };
  return { cmds: [{ c: 'move', player, units: units.map((u) => u.id), x, y, attackMove: true, queue }], x, y };
}
