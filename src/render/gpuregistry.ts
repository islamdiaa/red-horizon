/**
 * Every WebGLRenderer that uploads a geometry, material, texture or render target registers a
 * 'dispose' listener on it, and renderer.dispose() does not remove those listeners. Shared, cached
 * resources (model templates, material caches, module-level textures) would therefore pin every
 * finished game's renderer in memory. We record objects that gain a 'dispose' listener and dispose
 * them all when a game ends: that fires (and removes) the listeners. The objects stay usable; the
 * next renderer re-uploads them on first use.
 */
import * as THREE from 'three';

type Listenable = THREE.EventDispatcher<any> & { _listeners?: Record<string, unknown[]>; dispose?: () => void };
const live = new Set<Listenable>();

{
  const proto = THREE.EventDispatcher.prototype as unknown as {
    addEventListener(this: Listenable, type: string, listener: unknown): void;
    removeEventListener(this: Listenable, type: string, listener: unknown): void;
  };
  const add = proto.addEventListener, remove = proto.removeEventListener;
  proto.addEventListener = function (type, listener) {
    if (type === 'dispose') live.add(this);
    add.call(this, type, listener);
  };
  proto.removeEventListener = function (type, listener) {
    remove.call(this, type, listener);
    if (type === 'dispose' && !this._listeners?.dispose?.length) live.delete(this);
  };
}

/** Release every renderer's GPU copy of every resource uploaded so far (call when a game is torn down). */
export function releaseGpuResources() {
  for (const o of [...live]) o.dispose?.();
  live.clear();
}

/** Number of resources currently holding renderer listeners (diagnostics). */
export const trackedGpuResources = () => live.size;
