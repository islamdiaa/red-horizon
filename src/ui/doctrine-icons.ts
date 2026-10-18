import { ICONS } from './icons';

/** Icons of the doctrines (DoctrineDef.icon keys); three-free, so the menu's doctrine picker needn't load the battle UI. */
export const DOCTRINE_ICONS: Record<string, string> = {
  tank: ICONS.vehicle, infantry: ICONS.people, bolt: ICONS.boltSolid, rocket: ICONS.aircraft, speed: ICONS.gauge, fort: ICONS.defense,
  target: ICONS.target, eye: ICONS.eye,
};
