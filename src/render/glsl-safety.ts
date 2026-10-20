/**
 * NaN safety for every built-in three.js material, applied once before any shader compiles.
 *
 * three normalises interpolated normals and tangents with normalize(), and normalize() of a zero vector is
 * NaN on real GPUs (SwiftShader happens to return 0). A zero normal comes from model data (collapsed
 * decimation fans, degenerate UVs) or from a model matrix with a zero-scale axis (the inverse-transpose
 * normal matrix is then all zeros). One NaN pixel in the HDR scene target is enough: the temporal filter
 * spreads it into black dots and the bloom's clamp turns it into white blobs. The patched chunks fall back
 * to a camera-facing normal instead.
 */
import * as THREE from 'three';

const SAFE = '\nvec3 rhSafeNormalize( vec3 v ) { float l = dot( v, v ); return l > 1e-24 ? v * inversesqrt( l ) : vec3( 0.0, 0.0, 1.0 ); }\n';

let done = false;

export function installGlslSafety(): void {
  if (done) return;
  done = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (!C.common.includes('rhSafeNormalize')) C.common += SAFE;
  C.normal_vertex = C.normal_vertex
    .replace('normalize( transformedNormal )', 'rhSafeNormalize( transformedNormal )')
    .replace('normalize( transformedTangent )', 'rhSafeNormalize( transformedTangent )')
    .replace('normalize( cross( vNormal, vTangent ) * tangent.w )', 'rhSafeNormalize( cross( vNormal, vTangent ) * tangent.w )');
  C.normal_fragment_begin = C.normal_fragment_begin
    .replace('normalize( cross( fdx, fdy ) )', 'rhSafeNormalize( cross( fdx, fdy ) )')
    .replace('normalize( vNormal )', 'rhSafeNormalize( vNormal )')
    .replace(/normalize\( vTangent \), normalize\( vBitangent \)/g, 'rhSafeNormalize( vTangent ), rhSafeNormalize( vBitangent )');
}

installGlslSafety();
