/**
 * The scenery chunk's entry (loaded by src/render/scenery.ts): registers the civilian building templates with the
 * model registry and stands the landmarks of a battlefield in the scene.
 */
import type * as THREE from 'three';
import type { Culture } from '../../conquest/world/types';
import type { CivilianKind } from '../../sim/civilian';
import type { GameMap } from '../../sim/map';
import { WATER_LEVEL } from '../../sim/map';
import { LANDMARK_SETTING, type PlacedLandmark } from '../../sim/landmarks';
import { setExtraTemplateBuilder } from '../models';
import { forgetFractures } from '../destruction';
import type { ModelTemplate } from '../models/builder';
import { civilianTemplate, dropCivilianTemplates } from '../civilian';
import { CivilianChunks, type SceneryViewLike } from '../civilian/chunks';
import { buildLandmark, setLandmarkLit, SCENERY_HEX } from './index';
import type { Detail } from './kit';

/** Template for a registry key 'civ:<style>:<kind>:<variant>:<detail>:<facing>' (null for any other key). */
function sceneryTemplate(key: string): ModelTemplate | null {
  if (!key.startsWith('civ:')) return null;
  const [, style, kind, variant, detail, facing] = key.split(':');
  return civilianTemplate(style as Culture, kind as CivilianKind, +variant || 0, detail === 'low' ? 'low' : 'high', +facing || 0);
}

let installed = false;
export function installScenery(): void {
  if (installed) return;
  installed = true;
  setExtraTemplateBuilder(sceneryTemplate);
}

/** Ground height a landmark stands at (bridges: their land ends, never below the water surface). */
function standHeight(map: GameMap, l: PlacedLandmark): number {
  const cx = l.cx + l.w / 2, cy = l.cy + l.h / 2;
  if (LANDMARK_SETTING[l.id] === 'span') {
    const alongX = l.facing % 2 === 0;
    const a = alongX ? map.heightAt(l.cx + 1, cy) : map.heightAt(cx, l.cy + 1);
    const b = alongX ? map.heightAt(l.cx + l.w - 1, cy) : map.heightAt(cx, l.cy + l.h - 1);
    return Math.max(WATER_LEVEL, (a + b) / 2);
  }
  // the lowest of the centre and the footprint's quarter points: the model's skirt covers the rest
  let h = map.heightAt(cx, cy);
  for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) h = Math.min(h, map.heightAt(l.cx + l.w * fx, l.cy + l.h * fy));
  return h;
}

/** A match's scenery: the landmarks of the map as meshes (lit at night) and the civilian buildings merged per chunk. */
export function createSceneryLayer(scene: THREE.Scene, map: GameMap, detail: Detail) {
  const meshes: THREE.Mesh[] = [];
  for (const l of map.landmarks) {
    try {
      const m = buildLandmark(l.id, detail, map.climate);
      m.position.set(l.cx + l.w / 2, standHeight(map, l), l.cy + l.h / 2);
      m.rotation.y = (-l.facing * Math.PI) / 2;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      meshes.push(m);
    } catch (e) {
      console.warn('[landmarks] failed to build', l.id, e);
    }
  }
  // a new battle: forget the civilian templates of other styles (their geometry is not shared with this one)
  dropCivilianTemplates(map.civilianSites?.[0]?.culture);
  forgetFractures('civ:');
  const chunks = map.civilianSites?.length ? new CivilianChunks(scene, SCENERY_HEX) : null;
  let lit = false;
  return {
    update(night: number, views: Iterable<unknown>) {
      chunks?.update(views as Iterable<SceneryViewLike>, night);
      const want = night > 0.32;
      if (want === lit) return;
      lit = want;
      for (const m of meshes) setLandmarkLit(m, lit);
    },
    dispose() {
      chunks?.dispose();
      for (const m of meshes) m.removeFromParent();
      meshes.length = 0;
    },
  };
}
