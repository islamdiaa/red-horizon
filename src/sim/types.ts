import type { ExplosionKind, WeaponDef } from '../data/rules';
import type { AnnouncerKey, SfxKey } from '../audio/types';
import type { SuperKind } from './superweapons';

/** Simulation rate. Rendering interpolates between ticks. */
export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export type QueueKind = 'structure' | 'infantry' | 'vehicle' | 'aircraft' | 'naval';

export type Order =
  | { type: 'idle' }
  /** `formation`: id of the FormationGroup (formation.ts) steering the unit while in transit. */
  | { type: 'move'; x: number; y: number; attackMove: boolean; started?: boolean; formation?: number }
  | { type: 'attack'; target: number; forced: boolean; resume?: Order }
  | { type: 'attackGround'; x: number; y: number }
  | { type: 'harvest'; x?: number; y?: number }
  | { type: 'enter'; target: number }
  | { type: 'deploy' }
  | { type: 'guard'; x: number; y: number }
  /** Minelayer: lay a mine in each of these cells (map indices), nearest first (mines.ts). */
  | { type: 'layMines'; cells: number[]; tries?: number; field?: boolean }
  /** Engineer: walk to an end of a destroyed bridge and rebuild it (bridges.ts). */
  | { type: 'repairBridge'; bridge: number }
  /** [CTRL] Loop through `points`, engaging on the way (orders.ts). `idx` = point heading for. */
  | { type: 'patrol'; points: [number, number][]; idx: number; started?: boolean }
  /** [CTRL] Escort / guard a unit or structure: keep station at angle `a`, radius `r` around it and defend it (orders.ts). */
  | { type: 'escort'; target: number; a: number; r: number };

/** [CTRL] Formation shapes ('none' = automatic: keep relative positions, see formation.ts). */
export type FormationShape = 'line' | 'box' | 'wedge' | 'none';

/** [CTRL] One planned structure of a build plan (Player.buildPlan): type and top-left footprint cell. */
export interface PlanItem { type: string; cx: number; cy: number }

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
  | { c: 'superweapon'; player: number; kind: SuperKind; x: number; y: number; unit?: number }
  | { c: 'stance'; player: number; units: number[]; stance: Stance }
  /** Minelayers lay a small minefield around (x, y) (deploy = one mine under the minelayer). */
  | { c: 'mine'; player: number; units: number[]; x: number; y: number }
  /** Engineers rebuild a destroyed bridge (World.bridges id) from its nearest end. */
  | { c: 'repairBridge'; player: number; units: number[]; bridge: number }
  /** [CONTENT] A Chrono Tank chronoshifts itself to (x, y) (explored, open ground) when its own charge is full (aftermath.ts). */
  | { c: 'chronoJump'; player: number; unit: number; x: number; y: number }
  // --- [CTRL] unit control (orders.ts / formation.ts)
  /** Loop through the points (each unit starts from where it stands), attack-moving. `queue`: after current orders. */
  | { c: 'patrol'; player: number; units: number[]; points: [number, number][]; queue?: boolean }
  /** Escort / guard an own or allied unit or structure: follow it and defend it. */
  | { c: 'guard'; player: number; units: number[]; target: number; queue?: boolean }
  /** Set the formation the units keep on group moves ('none' = automatic); idle units re-form on the spot. */
  | { c: 'formation'; player: number; units: number[]; shape: FormationShape }
  /** A factory's new units join and guard this unit (0 = back to the normal rally point). */
  | { c: 'rallyUnit'; player: number; building: number; target: number }
  /**
   * Planned build order (Player.buildPlan): the Construction Yard builds the items in order when affordable and
   * places each at its cell. mode 'append' (default) adds items, 'replace' sets the plan (items [] = clear),
   * 'remove' drops the listed items (matched by type and cell).
   */
  | { c: 'queuePlan'; player: number; items: PlanItem[]; mode?: 'append' | 'replace' | 'remove' };

/** How a unit picks fights: chase anything seen / engage in range and return (default) / never move / never fire unprompted. */
export type Stance = 'aggressive' | 'guard' | 'hold' | 'passive';

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
  | { e: 'gameover'; winnerTeam: number }
  /** A spy (intel / sonar) or thief (credits stolen, `amount`) got into a structure. */
  | { e: 'infiltrate'; building: number; player: number; victim: number; kind: 'spy' | 'thief'; amount: number; x: number; y: number }
  /** A bridge collapsed or was rebuilt (World.bridges id). */
  | { e: 'bridge'; id: number; alive: boolean }
  /** [CONTENT] One seismic pulse of a deployed M.A.D. Tank (unit `id`), `pulse` of `pulses`, hitting everything within `radius` (aftermath.ts). */
  | { e: 'quake'; id: number; x: number; y: number; radius: number; pulse: number; pulses: number }
  /** Support power effects for the renderer: GPS launch (map reveal), sonar pulse, spy-plane photo, paradrop. */
  | { e: 'power'; kind: 'gps' | 'sonar' | 'spyplane' | 'paratroopers' | 'parabombs'; player: number; x: number; y: number };
