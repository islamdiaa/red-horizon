/**
 * World Conquest landmarks, modelled in code (no downloaded assets): `buildLandmark(id, detail)` returns one merged
 * mesh drawn with the game's body material, standing on y = 0 at the origin, centred on its footprint
 * (LANDMARK_FOOTPRINTS, cells = world units) with its front to +z. `landmarkThumb(id)` renders a cached portrait for
 * the globe and the cards. Lazy chunk: import it with `await import('../render/landmarks')`.
 *
 * Budgets: about 3k triangles on 'low', about 20k on 'high', one draw call each. Built once per (id, detail) and
 * cached (the template builder bakes cavity occlusion and ground AO like every structure's).
 */
import * as THREE from 'three';
import { LANDMARK_IDS, type LandmarkId } from '../../conquest/world/types';
import { LANDMARK_FOOTPRINTS } from '../../sim/landmarks';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NB, makeTemplate } from '../models/builder';
import { bodyMaterial, BodyVariant, getModelSnow, setBodyTime, setModelSnow, shadowDepthMaterial } from '../models/materials';
import type { LandmarkBuilder } from './common';
import { type Detail, hashStr, lin, setGroundTone } from './kit';
import { getThumbStage } from '../thumbnails';
import { EUROPE } from './europe';
import { AFRICA } from './africa';
import { ASIA } from './asia';
import { AMERICAS } from './americas';

export type { Detail } from './kit';

/** Team colour of scenery materials (no part of a landmark is team-painted; this keeps them apart from units). */
export const SCENERY_HEX = 0x8a8a89;

const BUILDERS: Partial<Record<string, LandmarkBuilder>> = { ...EUROPE, ...AFRICA, ...ASIA, ...AMERICAS };

/** Landmarks that have their real model (the others show a placeholder monument until they land). */
export function landmarkModelled(id: LandmarkId): boolean {
  return !!BUILDERS[id];
}

/** Placeholder: a stone obelisk on a plinth (only for ids without a model yet). */
const placeholder: LandmarkBuilder = (k) => {
  k.nb.box({ c: 0xb8ad96, m: 0, r: 0.9, d: 1 }, 1.6, 0.3, 1.6, 0, 0.15, 0, { b: 0 });
  k.nb.add(new THREE.CylinderGeometry(0.0, 0.32, 2.4, 4).rotateY(Math.PI / 4), { c: 0xcfc3a6, m: 0, r: 0.9, d: 1 }, { p: [0, 1.5, 0] });
};

interface Built {
  geo: THREE.BufferGeometry;
  /** The see-through cloud / mist layer, if the landmark has one (one extra draw call). */
  fx: THREE.BufferGeometry | null;
  tris: number;
  height: number;
  radius: number;
}

const cache = new Map<string, Built>();

/** Landmarks that are mostly terrain (mountains, cliffs, falls, ridges): their rims must melt into the ground. */
const NATURAL = new Set<string>(['matterhorn', 'table-mountain', 'kilimanjaro', 'mount-fuji', 'sugarloaf', 'machu-picchu', 'victoria-falls', 'great-wall', 'mount-rushmore', 'petra']);

/** The merged geometry of a landmark (cached; shared by every mesh of it: do not modify). */
/** Battlefield climates (the map's visual climate): the ground colour natural landmarks fade into at their rim. */
export type GroundClimate = 'temperate' | 'winter' | 'desert' | 'tropical';
const GROUND_TONE: Record<GroundClimate, number> = { temperate: 0x5e6a3c, winter: 0xc6ccd2, desert: 0xbea171, tropical: 0x4c6630 };
/** The Low preset's terrain is brighter and more saturated (terrain-low.ts): its own tones. */
const GROUND_TONE_LOW: Record<GroundClimate, number> = { temperate: 0x62803a, winter: 0xd0d6dc, desert: 0xc8aa6c, tropical: 0x4e7a32 };

export function landmarkGeometry(id: LandmarkId, detail: Detail, fresh = false, climate: GroundClimate = 'temperate'): Built {
  const key = `${id}|${detail}|${climate}`;
  let b = fresh ? undefined : cache.get(key);
  if (b) {
    cache.delete(key); // most recently used last
    cache.set(key, b);
    return b;
  }
  const hi = detail === 'high';
  const nb = new NB('root');
  // terrain-like landmarks: no ground AO or cavity bake (both darken a height field's rim into a visible ring)
  const natural = NATURAL.has(id);
  nb.ao = natural ? undefined : { h: 0.35, min: 0.62 };
  nb.snow = 1;
  nb.cavity = !natural;
  const tones = detail === 'low' ? GROUND_TONE_LOW : GROUND_TONE;
  setGroundTone(lin(tones[climate] ?? tones.temperate));
  const fxParts: THREE.BufferGeometry[] = [];
  try {
    (BUILDERS[id] ?? placeholder)({ nb, hi, seed: hashStr(id), fx: fxParts });
  } finally {
    setGroundTone(null);
  }
  const tpl = makeTemplate({ root: nb, height: 1, radius: 1 });
  const skin = tpl.skin!;
  const geo = hi ? skin.geo : skin.geoLo ?? skin.geo;
  // fit the footprint the sim stands it on (uniform scale: proportions are what makes it recognisable)
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const fp = LANDMARK_FOOTPRINTS[id];
  const ext = (a: number, c: number) => 2 * Math.max(Math.abs(a), Math.abs(c));
  const s = Math.min(1, (fp.w + 0.02) / ext(bb.min.x, bb.max.x), (fp.h + 0.02) / ext(bb.min.z, bb.max.z));
  if (s < 0.999) geo.scale(s, s, s);
  const fx = fxParts.length ? mergeGeometries(fxParts.map((g) => g.index ? g.toNonIndexed() : g), false) : null;
  if (fx) {
    if (s < 0.999) fx.scale(s, s, s);
    fx.computeBoundingSphere();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.landmark = id;
  b = {
    geo,
    fx,
    tris: (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3,
    height: geo.boundingBox!.max.y,
    radius: Math.hypot(fp.w, fp.h) / 2,
  };
  if (!fresh) {
    cache.set(key, b);
    // a long campaign visits many landmarks: keep the most recent few (an evicted one is rebuilt on demand)
    while (cache.size > CACHE_MAX) {
      const [k0, old] = cache.entries().next().value as [string, Built];
      cache.delete(k0);
      old.geo.dispose();
      old.fx?.dispose();
    }
  }
  return b;
}

/** Landmark geometries kept (least recently built ones go first). */
const CACHE_MAX = 8;

/**
 * One landmark as a single mesh (body material, casts and receives shadows). Its windows and lamps light up when
 * `setLandmarkLit(mesh, true)` (the battle's layer does that at night).
 */
export function buildLandmark(id: LandmarkId, detail: Detail, climate: GroundClimate = 'temperate'): THREE.Mesh {
  const b = landmarkGeometry(id, detail, false, climate);
  const mesh = new THREE.Mesh(b.geo, bodyMaterial(SCENERY_HEX, BodyVariant.Normal, false));
  mesh.name = `landmark:${id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = shadowDepthMaterial(mesh);
  mesh.userData.height = b.height;
  if (b.fx) {
    const c = new THREE.Mesh(b.fx, cloudMaterial());
    c.name = 'landmark-cloud';
    c.renderOrder = 1;
    mesh.add(c);
  }
  return mesh;
}

let cloudMat: THREE.MeshStandardMaterial | null = null;
/**
 * Soft see-through cloud (shared by every landmark's cloud layer): alpha from the vertex colour (ragged sheet edges)
 * times a fresnel falloff, so puffs fade out towards their silhouettes instead of ending in a hard rim. Alpha-blended,
 * no depth writes (units and terrain behind and in front sort by depth test as usual), both sides.
 */
function cloudMaterial(): THREE.MeshStandardMaterial {
  if (!cloudMat) {
    const m = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 1, metalness: 0, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
  float rhFacing = abs( dot( normal, normalize( vViewPosition ) ) );
  diffuseColor.a *= smoothstep( 0.04, 0.7, rhFacing );
}
#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'rh-landmark-cloud';
    m.name = 'landmark-cloud';
    cloudMat = m;
  }
  return cloudMat;
}

/** Light a landmark's windows and lamps (night) or put them out (day). */
export function setLandmarkLit(mesh: THREE.Mesh, lit: boolean): void {
  mesh.material = bodyMaterial(SCENERY_HEX, BodyVariant.Normal, lit);
}

/** Every landmark id with its triangle count per detail (tests, the contact sheet). */
export function landmarkStats(): { id: LandmarkId; low: number; high: number; modelled: boolean }[] {
  return LANDMARK_IDS.map((id) => ({ id, low: landmarkGeometry(id, 'low').tris, high: landmarkGeometry(id, 'high').tris, modelled: landmarkModelled(id) }));
}

// ---------------------------------------------------------------------------------------------------------
// thumbnails (globe, cards): the shared portrait stage of src/render/thumbnails.ts
// ---------------------------------------------------------------------------------------------------------

const thumbs = new Map<string, string>();

/**
 * A portrait of a landmark: PNG data URL, size x size, transparent background, three-quarter daylight view.
 * Synchronous and cached per (id, size): the first call per id builds the model and renders it (tens of ms).
 */
export function landmarkThumb(id: LandmarkId, size = 96): string {
  const key = `${id}|${size}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  landmarkThumbs([id], size);
  return thumbs.get(key) ?? '';
}

/** Render several portraits in one go (one environment bake); returns id -> data URL. */
export function landmarkThumbs(ids: readonly LandmarkId[], size = 96): Map<LandmarkId, string> {
  const out = new Map<LandmarkId, string>();
  const todo = ids.filter((id) => {
    const hit = thumbs.get(`${id}|${size}`);
    if (hit) out.set(id, hit);
    return !hit;
  });
  if (!todo.length) return out;
  if (typeof document === 'undefined') return out;
  const stage = getThumbStage(size, size);
  const { renderer, scene, canvas, env } = stage;
  scene.environment = env;
  const snow = getModelSnow();
  setModelSnow(0);
  setBodyTime(0.1);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 200);
  // nothing below ground level: the sunken rims of mounds and mountains would show as a plate on a transparent card
  const clip = renderer.clippingPlanes;
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.015)];
  const box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  for (const id of todo) {
    try {
      const mesh = buildLandmark(id, 'high');
      mesh.rotation.y = -0.38; // three-quarter view
      scene.add(mesh);
      mesh.updateMatrixWorld(true);
      box.setFromObject(mesh);
      box.getSize(sz);
      box.getCenter(c);
      const radius = Math.max(sz.x, sz.y, sz.z) * 0.55;
      const dist = radius / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      cam.position.set(c.x + dist * 0.18, c.y + dist * 0.42, c.z + dist * 0.89);
      cam.lookAt(c.x, c.y - sz.y * 0.04, c.z);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/png');
      thumbs.set(`${id}|${size}`, url);
      out.set(id, url);
      scene.remove(mesh);
    } catch (e) {
      console.warn('landmark thumbnail failed', id, e);
    }
  }
  renderer.clippingPlanes = clip;
  setModelSnow(snow);
  scene.environment = null;
  stage.done();
  return out;
}
