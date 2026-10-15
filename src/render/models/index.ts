/**
 * Procedural model library.
 *
 *   createModel(typeId, teamColor)   -> ModelInstance (shared geometry/materials, cheap to create)
 *   createProjectileModel(kind)      -> Object3D facing +X
 *   listModelIds()                   -> every id with a dedicated model
 *
 * See types.ts for conventions. Templates are built lazily once per type id and cached.
 */
import * as THREE from 'three';
import type { ModelInstance, ProjectileModelKind } from './types';
import { NB, instantiate, makeTemplate, type ModelTemplate } from './builder';
import { M, G, foundation, lamp } from './parts';
import { healthVariant } from './anim';
import { VEHICLE_BUILDERS } from './vehicles';
import { INFANTRY_BUILDERS } from './infantry';
import { AIRCRAFT_BUILDERS } from './aircraft';
import { STRUCTURE_BUILDERS } from './structures';
import { DEFENSE_BUILDERS } from './defenses';
import { NAVAL_BUILDERS } from './naval';
import { SUPPORT_BUILDERS } from './support';
import { createProjectile } from './projectiles';

export type { ModelInstance, ModelAnimState, ProjectileModelKind } from './types';

const BUILDERS: Record<string, () => ModelTemplate> = {
  ...INFANTRY_BUILDERS,
  ...VEHICLE_BUILDERS,
  ...AIRCRAFT_BUILDERS,
  ...STRUCTURE_BUILDERS,
  ...DEFENSE_BUILDERS,
  ...NAVAL_BUILDERS,
  ...SUPPORT_BUILDERS,
};

/**
 * Ids that share another id's template (fake structures must look exactly like the real thing).
 * They are listed by listModelIds() but never build a second copy of the geometry.
 */
const ALIASES: Record<string, string> = {
  facf: 'fact',
  weaf: 'weap',
  syrf: 'syrd',
  spef: 'spen',
  domf: 'dome',
};

const templates = new Map<string, ModelTemplate>();

function fallbackTemplate(): ModelTemplate {
  const r = new NB('root');
  r.ao = { h: 0.3, min: 0.6 };
  foundation(r, 1, 1);
  r.box(M.team, 0.6, 0.4, 0.6, 0, 0.24, 0, { b: 0.04, seg: 2 });
  r.box(M.gun, 0.66, 0.06, 0.66, 0, 0.47, 0, { b: 0.02 });
  lamp(r, G.red, [0, 0.53, 0], 0.03);
  return makeTemplate({
    root: r,
    height: 0.55,
    radius: 0.45,
    muzzles: [],
    glow: { glow: 3 },
    anim: (c, s) => {
      healthVariant(c, s);
      c.setPowered(s.powered);
    },
  });
}

function getTemplate(typeId: string): ModelTemplate {
  typeId = ALIASES[typeId] ?? typeId;
  let t = templates.get(typeId);
  if (t) return t;
  const b = BUILDERS[typeId];
  try {
    t = b ? b() : fallbackTemplate();
  } catch (e) {
    console.error(`[models] failed to build '${typeId}'`, e);
    t = fallbackTemplate();
  }
  templates.set(typeId, t);
  return t;
}

const _white = new THREE.Color(0xffffff);

/** Create a renderable instance of a unit/structure type. Unknown ids get a generic box. */
export function createModel(typeId: string, teamColor: THREE.Color): ModelInstance {
  return instantiate(getTemplate(typeId), teamColor ?? _white, typeId);
}

/** Create a projectile model (faces +X). */
export function createProjectileModel(kind: ProjectileModelKind): THREE.Object3D {
  return createProjectile(kind);
}

/** All type ids that have a dedicated model. */
export function listModelIds(): string[] {
  return [...Object.keys(BUILDERS), ...Object.keys(ALIASES)];
}

/** The id whose template `typeId` renders with (fake structures map to the real building). */
export function modelAliasOf(typeId: string): string {
  return ALIASES[typeId] ?? typeId;
}

/** Optional: build all templates up-front (e.g. during a loading screen). */
export function prewarmModels(ids: string[] = listModelIds()): void {
  for (const id of ids) getTemplate(id);
}
