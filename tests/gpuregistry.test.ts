import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { releaseGpuResources, trackedGpuResources } from '../src/render/gpuregistry';

describe('GPU resource registry (renderer leak guard)', () => {
  test('objects gain tracking when a renderer-style dispose listener is added, and lose it when removed', () => {
    releaseGpuResources();
    const geo = new THREE.BufferGeometry();
    const onDispose = () => {};
    geo.addEventListener('dispose', onDispose);
    assert.equal(trackedGpuResources(), 1, 'tracked after addEventListener');
    geo.removeEventListener('dispose', onDispose);
    assert.equal(trackedGpuResources(), 0, 'untracked once its last dispose listener is gone');
  });

  test('releaseGpuResources fires every listener (as a renderer would see on dispose) and empties the registry', () => {
    releaseGpuResources();
    const mat = new THREE.MeshStandardMaterial();
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    let fired = 0;
    // mimic three's WebGLRenderer, which removes its own listener inside the handler
    const onMat = () => { fired++; mat.removeEventListener('dispose', onMat); };
    const onTex = () => { fired++; tex.removeEventListener('dispose', onTex); };
    mat.addEventListener('dispose', onMat);
    tex.addEventListener('dispose', onTex);
    assert.equal(trackedGpuResources(), 2, 'both tracked');
    releaseGpuResources();
    assert.equal(fired, 2, 'both dispose listeners fired');
    assert.equal(trackedGpuResources(), 0, 'registry empty');
    // objects stay usable afterwards
    assert.equal(mat.type, 'MeshStandardMaterial', 'material still intact');
  });

  test('other event types are not tracked', () => {
    releaseGpuResources();
    const obj = new THREE.Object3D();
    obj.addEventListener('added', () => {});
    assert.equal(trackedGpuResources(), 0, 'non-dispose listeners ignored');
  });
});
