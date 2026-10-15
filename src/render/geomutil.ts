import type * as THREE from 'three';

/** Non-indexed version of a geometry (the geometry itself if it already is one, which three warns about). */
export const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
