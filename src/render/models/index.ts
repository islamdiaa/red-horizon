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
import { NB, instantiate, makeTemplate, type ModelFaction, type ModelTemplate } from './builder';
import { M, G, foundation, lamp } from './parts';
import { healthVariant } from './anim';
import { VEHICLE_BUILDERS } from './vehicles';
import { INFANTRY_BUILDERS } from './infantry';
import { AIRCRAFT_BUILDERS } from './aircraft';
import { STRUCTURE_BUILDERS, FACTION_DRESSED } from './structures';
import { DEFENSE_BUILDERS } from './defenses';
import { NAVAL_BUILDERS } from './naval';
import { SUPPORT_BUILDERS } from './support';
import { AFTERMATH_BUILDERS } from './aftermath';
import { NEUTRAL_BUILDERS } from './neutral'; // [VARIETY] neutral tech structures, supply truck
import { createProjectile } from './projectiles';
import { hdModelsEnabled, hdWrap, holdHd, preloadHdModels, requestHd } from './hd'; // [HD]

export type { ModelInstance, ModelAnimState, ProjectileModelKind } from './types';
export type { ModelFaction } from './builder';

// [STRUCT] structure builders take the owner's faction (shared buildings get Soviet / Allied dressing)
const BUILDERS: Record<string, (fac: ModelFaction) => ModelTemplate> = {
  ...INFANTRY_BUILDERS,
  ...VEHICLE_BUILDERS,
  ...AIRCRAFT_BUILDERS,
  ...DEFENSE_BUILDERS,
  ...NAVAL_BUILDERS,
  ...SUPPORT_BUILDERS,
  ...AFTERMATH_BUILDERS,
  ...STRUCTURE_BUILDERS, // [STRUCT] last: the naval yards are structures too
  ...NEUTRAL_BUILDERS, // [VARIETY]
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

/**
 * [STRUCT] Faction of a team colour when the caller does not know the owner's faction: reds, oranges and
 * browns read as Soviet, everything else as Allied.
 */
export function guessFaction(color: THREE.Color): ModelFaction {
  const h = color.getHSL(_hsl);
  return h.s > 0.2 && (h.h < 0.11 || h.h > 0.93) ? 'soviet' : 'allies';
}
const _hsl = { h: 0, s: 0, l: 0 };

function templateKey(typeId: string, fac: ModelFaction): string {
  return FACTION_DRESSED.has(typeId) ? `${typeId}|${fac}` : typeId;
}

const keyCache: Record<ModelFaction, Map<string, string>> = { soviet: new Map(), allies: new Map() };

/**
 * [STRUCT] Geometry key of a type as seen for an owner faction: the type id itself, or 'type|faction' for the
 * structures dressed per faction. Accepted wherever a type id is (modelAliasOf, modelBodyGeometry), so caches
 * keyed by it (fracture bakes) keep the two dressings apart. Allocation-free after the first call per type.
 */
export function modelKey(typeId: string, faction: ModelFaction): string {
  const m = keyCache[faction] ?? keyCache.soviet;
  let k = m.get(typeId);
  if (k === undefined) {
    const base = ALIASES[typeId] ?? typeId;
    k = FACTION_DRESSED.has(base) ? `${typeId}|${faction}` : typeId;
    m.set(typeId, k);
  }
  return k;
}

function splitKey(id: string): [string, ModelFaction | undefined] {
  const i = id.indexOf('|');
  return i < 0 ? [id, undefined] : [id.slice(0, i), id.slice(i + 1) === 'allies' ? 'allies' : 'soviet'];
}

function getTemplate(typeId: string, fac: ModelFaction = 'soviet'): ModelTemplate {
  if (typeId.includes('|')) {
    const [t, f] = splitKey(typeId);
    typeId = t;
    fac = f ?? fac;
  }
  typeId = ALIASES[typeId] ?? typeId;
  const key = templateKey(typeId, fac);
  let t = templates.get(key);
  if (t) return t;
  const b = BUILDERS[typeId];
  try {
    t = b ? b(fac) : fallbackTemplate();
  } catch (e) {
    console.error(`[models] failed to build '${typeId}'`, e);
    t = fallbackTemplate();
  }
  templates.set(key, t);
  return t;
}

const _white = new THREE.Color(0xffffff);

/**
 * Create a renderable instance of a unit/structure type. Unknown ids get a generic box. `faction` = the
 * owner's faction (structures shared by both sides dress up as Soviet or Allied); guessed from the team
 * colour when omitted.
 */
export function createModel(typeId: string, teamColor: THREE.Color, faction?: ModelFaction): ModelInstance {
  const c = teamColor ?? _white;
  const fac = faction ?? guessFaction(c);
  const tpl = getTemplate(typeId, fac);
  const inst = instantiate(tpl, c, typeId);
  if (!hdModelsEnabled()) return inst; // [HD]
  const base = ALIASES[typeId] ?? typeId;
  return hdWrap(inst, tpl, base, fac, c.getHex(), FACTION_DRESSED.has(base)); // [HD] baked model on the procedural rig
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
  if (typeId.includes('|')) {
    const [t, f] = splitKey(typeId);
    return `${ALIASES[t] ?? t}|${f}`;
  }
  return ALIASES[typeId] ?? typeId;
}

/** [EDIT] Mod variants (src/mods): render a cloned type with its base type's model (null removes the alias). */
export function setModelAlias(typeId: string, baseId: string | null): void {
  if (baseId) ALIASES[typeId] = ALIASES[baseId] ?? baseId;
  else delete ALIASES[typeId];
  templates.delete(typeId);
  templates.delete(`${typeId}|soviet`);
  templates.delete(`${typeId}|allies`);
}

/**
 * The merged body geometry (model space, rest pose) a type renders with, or null; `far` = the distant
 * level of detail when the model has one. Used by the destruction system to bake fractures; do not modify it.
 */
export function modelBodyGeometry(typeId: string, far = false, faction?: ModelFaction): THREE.BufferGeometry | null {
  const skin = getTemplate(typeId, faction).skin;
  return (far ? skin?.geoLo : null) ?? skin?.geo ?? null;
}

/** Optional: build all templates up-front (e.g. during a loading screen). */
export function prewarmModels(ids: string[] = listModelIds()): void {
  for (const id of ids) {
    getTemplate(id, 'soviet');
    if (FACTION_DRESSED.has(ALIASES[id] ?? id)) getTemplate(id, 'allies');
  }
}

/**
 * [HD] Start loading a type's HD model as seen by an owner faction (lazy per-type loading): 'ready' = models
 * created now are HD; 'pending' = loading (procedural meanwhile, see hdReadyVersion); 'none' = no HD model.
 */
export function requestHdModel(typeId: string, faction: ModelFaction): 'ready' | 'pending' | 'none' {
  const base = ALIASES[typeId] ?? typeId;
  return requestHd(base, faction, FACTION_DRESSED.has(base));
}

/** [HD] Load the factions' common units plus the given (type, owner faction) pairs; resolves when ready or failed. */
export function preloadHd(factions: ModelFaction[], types: Iterable<[string, ModelFaction]> = [], onProgress?: (done: number, total: number) => void): Promise<void> {
  const list: [string, ModelFaction, boolean][] = [];
  for (const [t, f] of types) {
    const base = ALIASES[t] ?? t;
    list.push([base, f, FACTION_DRESSED.has(base)]);
  }
  return preloadHdModels(factions, list, onProgress);
}

/** [HD] A pending ref on a type's HD template (a view waiting to swap); release with releaseHd(key). */
export function holdHdModel(typeId: string, faction: ModelFaction): string | null {
  const base = ALIASES[typeId] ?? typeId;
  return holdHd(base, faction, FACTION_DRESSED.has(base));
}
