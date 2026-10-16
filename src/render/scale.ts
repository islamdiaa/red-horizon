import * as THREE from 'three';
import type { ModelInstance } from './models/types';

/**
 * [LOOK] Render-only unit scale and the model "look" hooks (rim light).
 *
 * True Red Alert proportions make soldiers a few pixels tall at RTS zoom. Units are drawn larger than their
 * simulation footprint so the screen reads as busy and legible (the sim, collision and ranges are untouched).
 * The scale goes on the model root, and the model's `height` / `radius` are scaled with it, so everything that
 * reads those (selection rings, health bars via `topOf`, picking, view culling) lines up; muzzles, smoke points
 * and ragdolls work in world space from the root matrix, so flashes, projectile origins and bodies follow.
 */
export const UNIT_VISUAL_SCALE = {
  infantry: 1.3, // main session: 1.5 made soldiers as tall as tank hulls
  vehicle: 1.15,
  aircraft: 1.1,
  naval: 1.1,
  building: 1,
} as const;

export type VisualKind = keyof typeof UNIT_VISUAL_SCALE;

/**
 * Per-type overrides: units that are already big on the RA grid grow less (they would swallow their cell, and
 * a 1-cell formation line of them would interpenetrate).
 */
export const UNIT_TYPE_SCALE: Readonly<Record<string, number>> = {
  harv: 1.06,
  mcv: 1.06,
  '4tnk': 1.06,
  mrj: 1.08,
  dog: 1.2,
};

/** Visual scale of a unit type of a kind (1 for structures). */
export function visualScale(kind: VisualKind, typeId?: string): number {
  if (kind === 'building') return 1;
  return (typeId && UNIT_TYPE_SCALE[typeId]) || UNIT_VISUAL_SCALE[kind] || 1;
}

/**
 * Apply the visual scale to a freshly created model (call once per model instance). Returns the scale so the
 * caller can keep it (e.g. to rescale a crushed body). Models never set their own root scale.
 */
export function applyVisualScale(model: ModelInstance, kind: VisualKind, typeId?: string): number {
  const s = visualScale(kind, typeId);
  if (s === 1) return 1;
  model.root.scale.setScalar(s);
  model.height *= s;
  model.radius *= s;
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// Rim light (lit model materials)

/**
 * Shared rim-light uniforms (stable for the page lifetime: model materials are cached across matches). The
 * renderer sets the colour each frame from the sky light; 0 turns the term off.
 */
export const RIM_UNIFORMS = { uRimColor: { value: new THREE.Color(0, 0, 0) } };

/**
 * A subtle fresnel rim on lit model materials: grazing surfaces pick up a little sky light, so units and
 * structures separate from the ground (cheap: a handful of ALU ops, no extra pass). Chains onto any existing
 * onBeforeCompile / program key (the weather surface patch and the body material's own patch).
 */
export function patchModelRim(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.rim) return;
  mat.userData.rim = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, RIM_UNIFORMS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;')
      .replace(
        '#include <opaque_fragment>',
        `{
          // [LOOK] fresnel rim from the sky, tinted by the surface (no plastic white edges), weaker on faces turned down
          float rimF = 1.0 - clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 );
          rimF = rimF * rimF * rimF;
          outgoingLight += uRimColor * rimF * ( 0.25 + 0.75 * diffuseColor.rgb );
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|rim`;
  mat.needsUpdate = true;
}
