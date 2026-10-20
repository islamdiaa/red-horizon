import type * as THREE from 'three';

/**
 * Capabilities of the game's WebGL context that decide how data textures are built. GameRenderer sets them
 * right after creating its context, before the terrain and water are made.
 * floatLinear: 32-bit float textures can be linearly filtered (OES_texture_float_linear). Many phones and
 * tablets lack it, and a float texture with linear filtering then samples as black (an incomplete texture).
 */
export const gpuCaps = { floatLinear: true };

export function setGpuCaps(renderer: THREE.WebGLRenderer): void {
  gpuCaps.floatLinear = renderer.extensions.has('OES_texture_float_linear');
}
