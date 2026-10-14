import type { ExplosionKind, WeaponDef } from '../data/rules';
import type { AnnouncerKey, SfxKey } from '../audio/types';

/** Simulation rate. Rendering interpolates between ticks. */
export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export type QueueKind = 'structure' | 'infantry' | 'vehicle' | 'aircraft';

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number; attackMove: boolean; started?: boolean }
  | { type: 'attack'; target: number; forced: boolean; resume?: Order }
  | { type: 'attackGround'; x: number; y: number }
  | { type: 'harvest'; x?: number; y?: number }
  | { type: 'enter'; target: number }
  | { type: 'deploy' }
  | { type: 'guard'; x: number; y: number };

/** Player-issued commands. All game-state changes from input/AI go through these. */
export type Command =
  | { c: 'move'; player: number; units: number[]; x: number; y: number; attackMove?: boolean; queue?: boolean }
  | { c: 'attack'; player: number; units: number[]; target: number; forced?: boolean }
  | { c: 'attackGround'; player: number; units: number[]; x: number; y: number }
  | { c: 'stop'; player: number; units: number[] }
  | { c: 'scatter'; player: number; units: number[] }
  | { c: 'deploy'; player: number; units: number[] }
  | { c: 'harvest'; player: number; units: number[]; x: number; y: number }
  | { c: 'enter'; player: number; units: number[]; target: number }
  | { c: 'build'; player: number; type: string; count?: number }
  | { c: 'cancel'; player: number; type: string; all?: boolean }
  | { c: 'pause'; player: number; type: string }
  | { c: 'place'; player: number; type: string; cx: number; cy: number; cx2?: number; cy2?: number }
  | { c: 'sell'; player: number; building: number }
  | { c: 'repair'; player: number; building: number }
  | { c: 'rally'; player: number; building: number; x: number; y: number }
  | { c: 'primary'; player: number; building: number }
  | { c: 'superweapon'; player: number; kind: 'nuke' | 'ironcurtain' | 'chrono'; x: number; y: number; unit?: number };

/** Events emitted by the simulation for renderer / audio / UI. Drained every frame. */
export type GameEvent =
  | { e: 'fire'; shooter: number; weapon: WeaponDef; muzzle: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; target?: number }
  | { e: 'projectile'; id: number }
  | { e: 'impact'; x: number; y: number; z: number; kind: ExplosionKind; scale: number; owner: number }
  | { e: 'death'; id: number; x: number; y: number; how: 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed' | 'sold' }
  | { e: 'placed'; id: number }
  | { e: 'captured'; id: number; from: number; to: number }
  | { e: 'harvest'; x: number; y: number; gems: boolean }
  | { e: 'credits'; player: number; amount: number; x: number; y: number }
  | { e: 'announce'; player: number; key: AnnouncerKey }
  | { e: 'sfx'; key: SfxKey; x: number; y: number }
  | { e: 'teleport'; id: number; fromX: number; fromY: number; x: number; y: number }
  | { e: 'ironcurtain'; x: number; y: number }
  | { e: 'nuke'; x: number; y: number; stage: 'launch' | 'incoming' }
  | { e: 'crate'; x: number; y: number; player: number; reward: 'money' | 'unit' | 'heal' | 'reveal'; amount: number }
  | { e: 'promoted'; id: number; rank: number }
  | { e: 'eliminated'; player: number }
  | { e: 'gameover'; winnerTeam: number };
