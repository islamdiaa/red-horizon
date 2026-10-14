import type * as THREE from 'three';

/**
 * Per-frame animation input for a model. The engine fills this in every render frame.
 * Coordinate conventions (1 world unit = 1 map cell):
 *   +X = east (screen right), +Z = south (towards the camera), +Y = up.
 *   Units face +X at rotation 0; the engine sets root.rotation.y = -heading.
 *   Structures face +Z (doors / docks on the +Z side), origin at footprint centre, ground level y=0.
 */
export interface ModelAnimState {
  /** Seconds since game start (monotonic). */
  time: number;
  /** Frame delta in seconds. */
  dt: number;
  /** Unit is currently moving. */
  moving: boolean;
  /** 0..1 fraction of max speed. */
  speed: number;
  /** 0..1 recoil pulse: 1 at the instant of firing, decays to 0 over ~0.25s. */
  firing: number;
  /** Index of the muzzle that fired most recently. */
  firingMuzzle: number;
  /** Structure has enough power. */
  powered: boolean;
  /** 0..1 health fraction. */
  health: number;
  /** 0..1 war factory door / hangar open amount. */
  door: number;
  /** 0..1 harvester cargo / refinery processing activity. */
  load: number;
  /** Harvester actively harvesting / refinery receiving ore. */
  harvesting: boolean;
  /** 0..1 tesla coil / superweapon charge. */
  charge: number;
  /** 0..1 infantry death animation progress (0 = alive). */
  dying: number;
  deathKind?: 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed';
  /** Aircraft altitude above ground (world units). */
  altitude?: number;
}

export interface ModelInstance {
  /** Root group; engine positions/rotates it. */
  root: THREE.Group;
  /** Rotates around local Y relative to the body (engine sets turret.rotation.y). */
  turret?: THREE.Object3D;
  /** Fire points. Local +X is the firing direction. Children of turret if there is one. */
  muzzles: THREE.Object3D[];
  /** Chimneys / exhausts that should emit smoke. */
  smokePoints?: THREE.Object3D[];
  /** Approximate top of the model (world units), used for health bar placement. */
  height: number;
  /** Approximate XZ radius, used for selection rings. */
  radius: number;
  update(state: ModelAnimState): void;
  dispose(): void;
}

export type ProjectileModelKind = 'shell' | 'missile' | 'scud' | 'grenade' | 'nuke' | 'fireball';
