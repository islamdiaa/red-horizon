/**
 * World Conquest scenery on battlefields, the renderer's always-loaded hook (keep it tiny): landmarks
 * (`map.landmarks`, sim/landmarks.ts) and civilian buildings (Buildings with `scenery`, sim/civilian.ts). The models
 * live in a lazy chunk (src/render/landmarks, src/render/civilian) loaded the first time a battle has any.
 *
 *  - Civilian buildings render through the normal model registry with a template key per look
 *    ('civ:<style>:<kind>:<variant>:<detail>:<facing>'), so damage stages, fracture, collapse and rubble work as for
 *    any structure. Their views wait (are not created) until the chunk has loaded.
 *  - Landmarks are one mesh each, placed once per match by a small layer.
 *  - Windows light up at night: building by building at dusk.
 */
import type * as THREE from 'three';
import type { Entity } from '../sim/entities';
import type { GameMap } from '../sim/map';
import { getModelDetail } from './models/builder';

interface CivScenery { culture: string; kind: string; seed: number; facing?: number }

type Impl = typeof import('./landmarks/register');
let impl: Impl | null = null;
let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let waiters: (() => void)[] = [];

/** Load the model chunk (once); resolves when ready (or failed: callers then fall back to plain boxes). */
export function loadScenery(): Promise<void> {
  if (state === 'ready' || state === 'failed') return Promise.resolve();
  const p = new Promise<void>((res) => waiters.push(res));
  if (state === 'idle') {
    state = 'loading';
    import('./landmarks/register').then(
      (m) => { impl = m; m.installScenery(); state = 'ready'; },
      (e) => { console.warn('[scenery] model chunk failed to load', e); state = 'failed'; },
    ).finally(() => { const w = waiters; waiters = []; for (const f of w) f(); });
  }
  return p;
}

const civOf = (e: Entity): CivScenery | null => (e as { scenery?: CivScenery }).scenery ?? null;

/**
 * The template key a civilian building renders with, or null for every other entity. Detail follows the quality
 * preset (Low = 'low').
 */
export function sceneryType(e: Entity): string | null {
  const s = civOf(e);
  if (!s) return null;
  const d = getModelDetail() === 0 ? 'low' : 'high';
  return `civ:${s.culture}:${s.kind}:${Math.abs(s.seed | 0) % 6}:${d}:${(s.facing ?? 0) & 3}`;
}

/** A civilian building whose models are still loading: don't create its view yet (starts the load). */
export function sceneryWait(e: Entity): boolean {
  if (state === 'ready' || state === 'failed' || !civOf(e)) return false;
  void loadScenery();
  return true;
}

/** Windows lit: after dusk, each building at its own moment (stable per entity). */
export function sceneryLit(e: Entity, night: number): boolean {
  const h = Math.imul(e.id ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  return night > 0.3 + ((h >>> 8) & 255) / 255 * 0.45;
}

/** What the scenery layer reads from the entity renderer's views (civilian buildings merged per chunk). */
export interface SceneryViewRef {
  ent: Entity;
  model: { root: THREE.Group };
  dead: boolean;
  anim: { health: number };
}

/** A match's scenery: its landmarks and its merged civilian buildings; update per frame, dispose at the end. */
export interface SceneryLayerHandle {
  update(night: number, views: Iterable<SceneryViewRef>): void;
  dispose(): void;
}

/** Stand a map's landmarks and merge its civilian buildings (nothing on maps without either). */
export function attachScenery(scene: THREE.Scene, map: GameMap): SceneryLayerHandle | null {
  if (!map.landmarks?.length && !map.civilianSites?.length) return null;
  let layer: SceneryLayerHandle | null = null;
  let gone = false;
  void loadScenery().then(() => {
    if (!gone && impl) layer = impl.createSceneryLayer(scene, map, getModelDetail() === 0 ? 'low' : 'high');
  });
  return {
    update: (night, views) => layer?.update(night, views),
    dispose: () => { gone = true; layer?.dispose(); layer = null; },
  };
}
