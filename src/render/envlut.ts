import * as THREE from 'three';
import { gpuCaps } from './gpucaps';

/**
 * Cheap image-based lighting for the terrain, which covers most of the screen. three.js samples the PMREM environment
 * with textureCubeUV (face selection, mip blending, two bilinear lookups): measured on an Intel UHD 770 at 1080p it
 * cost the full-screen terrain about as much as all of the rest of its lighting. The environment never changes during
 * a match (only scene.environmentIntensity, which is applied as before), so the same lookups are baked once into a
 * small octahedral table (one texture fetch each):
 *  - left half: the diffuse irradiance three computes (textureCubeUV at roughness 1, times PI), per world normal;
 *  - right half: the specular radiance at roughness ENV_LUT_ROUGHNESS, per world reflection direction (used only by
 *    the Low terrain, whose ground is rough everywhere; Medium and High keep three's exact radiance).
 * The irradiance is a smooth function, so bilinear interpolation of a 32x32 table reproduces three's value to well
 * within one 8-bit level (checked by tools/gpu-rig/lookab.mjs).
 */
const N = 32;
/** Roughness of the baked specular half (the Low ground: 0.93 dry, ~0.6 wet). */
export const ENV_LUT_ROUGHNESS = 0.85;

/** GLSL: octahedral uv (texel centres of an N x N table) of a unit direction, y up at the centre. */
const OCT_GLSL = /* glsl */ `
vec2 rhOctUv(vec3 d) {
  vec3 a = abs(d);
  vec2 p = d.xz / max(a.x + a.y + a.z, 1e-6);
  if (d.y < 0.0) p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return (p * 0.5 + 0.5) * ${((N - 1) / N).toFixed(6)} + ${(0.5 / N).toFixed(6)};
}`;

/**
 * Replaces three's envmap_physical_pars_fragment: getIBLIrradiance from the table; getIBLRadiance from the table too
 * when `bakedRadiance` (Low), else three's own (textureCubeUV). Needs `uniform sampler2D tEnvLut;` (declared here).
 */
export function envLutChunk(bakedRadiance: boolean): string {
  const orig = THREE.ShaderChunk.envmap_physical_pars_fragment;
  // three's own functions stay available (renamed) for everything this table does not replace
  const renamed = orig.replace('vec3 getIBLIrradiance(', 'vec3 rhIBLIrradianceCube(').replace('vec3 getIBLRadiance(', bakedRadiance ? 'vec3 rhIBLRadianceCube(' : 'vec3 getIBLRadiance(');
  return /* glsl */ `
uniform sampler2D tEnvLut;
${OCT_GLSL}
#ifdef USE_ENVMAP
vec3 getIBLIrradiance( const in vec3 normal ) {
  vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
  vec2 uv = rhOctUv( envMapRotation * worldNormal );
  return texture2D( tEnvLut, vec2( uv.x * 0.5, uv.y ) ).rgb * envMapIntensity;
}
${bakedRadiance ? /* glsl */ `
vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
  vec3 reflectVec = reflect( - viewDir, normal );
  reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
  reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
  vec2 uv = rhOctUv( envMapRotation * reflectVec );
  return texture2D( tEnvLut, vec2( 0.5 + uv.x * 0.5, uv.y ) ).rgb * envMapIntensity;
}` : ''}
#endif
${renamed}`;
}

/** True when this three.js version's chunk still has the functions envLutChunk replaces (tests). */
export function envLutChunkApplies(): boolean {
  const c = THREE.ShaderChunk.envmap_physical_pars_fragment;
  return c.includes('vec3 getIBLIrradiance(') && c.includes('vec3 getIBLRadiance(');
}

/**
 * The table: baked on the GPU from the PMREM environment, read back once and kept as a plain half-float DataTexture,
 * so it is valid in every WebGL context (the model materials it patches are cached for the page and also drawn by
 * the thumbnail renderer). Every renderer builds the same RoomEnvironment, so the table is made once per page. Where
 * float colour buffers cannot be read back, the render target itself serves the ground of that renderer, and the
 * model materials keep three's lookups.
 */
let shared: THREE.DataTexture | null = null;

export class EnvLut {
  private target: THREE.WebGLRenderTarget | null = null;
  private tex: THREE.Texture | null = shared;

  /** The table (null until bake()). */
  get texture(): THREE.Texture | null { return this.tex; }
  /** The table is a plain texture, valid in any WebGL context (it can serve the cached model materials). */
  get portable(): boolean { return !!this.tex && this.tex === shared; }

  /** Fill the table from a PMREM (CubeUV) environment texture (once per page; again after a lost context). */
  bake(renderer: THREE.WebGLRenderer, env: THREE.Texture | null, force = false) {
    if (shared && !force) { this.tex = shared; return; }
    const h = (env?.image as { height?: number } | undefined)?.height;
    if (!env || env.mapping !== THREE.CubeUVReflectionMapping || !h) return;
    const maxMip = Math.log2(h) - 2;
    const mat = new THREE.ShaderMaterial({
      name: 'env-lut-bake',
      defines: {
        ENVMAP_TYPE_CUBE_UV: '',
        CUBEUV_TEXEL_WIDTH: String(1 / (3 * Math.max(2 ** maxMip, 7 * 16))),
        CUBEUV_TEXEL_HEIGHT: String(1 / h),
        CUBEUV_MAX_MIP: `${maxMip}.0`,
      },
      uniforms: { envMap: { value: env } },
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <common>
        uniform sampler2D envMap;
        #include <cube_uv_reflection_fragment>
        void main() {
          // texel k of a half <-> octahedral coordinate k / (N - 1) * 2 - 1 (rhOctUv maps back to texel centres)
          vec2 k = floor(gl_FragCoord.xy);
          bool spec = k.x >= ${N}.0;
          if (spec) k.x -= ${N}.0;
          vec2 e = k / ${N - 1}.0 * 2.0 - 1.0;
          vec3 v = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
          if (v.y < 0.0) v.xz = (1.0 - abs(v.zx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.z >= 0.0 ? 1.0 : -1.0);
          vec3 d = normalize(v);
          gl_FragColor = spec ? vec4(textureCubeUV(envMap, d, ${ENV_LUT_ROUGHNESS.toFixed(3)}).rgb, 1.0)
                              : vec4(PI * textureCubeUV(envMap, d, 1.0).rgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    // 32-bit float where it can be read back (EXT_color_buffer_float), else half float kept on this renderer
    const readable = renderer.extensions.has('EXT_color_buffer_float');
    const target = this.target ?? new THREE.WebGLRenderTarget(2 * N, N, {
      type: readable ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false,
      minFilter: readable ? THREE.NearestFilter : THREE.LinearFilter, magFilter: readable ? THREE.NearestFilter : THREE.LinearFilter, generateMipmaps: false,
    });
    target.texture.name = 'env-lut';
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, _cam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
    quad.geometry.dispose();
    mat.dispose();
    // read it back into a context-independent texture (needs readable float colour buffers)
    let data: Float32Array | null = readable && target.texture.type === THREE.FloatType ? new Float32Array(2 * N * N * 4) : null;
    if (data) {
      try {
        renderer.readRenderTargetPixels(target, 0, 0, 2 * N, N, data);
        if (!data.some((v) => v > 0) || data.some((v) => !Number.isFinite(v))) data = null;
      } catch {
        data = null;
      }
    }
    if (data) {
      const half = new Uint16Array(data.length);
      for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
      const t = new THREE.DataTexture(half, 2 * N, N, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.name = 'env-lut';
      t.needsUpdate = true;
      shared = t;
      this.tex = t;
      target.dispose();
      this.target = null;
    } else {
      // (a 32-bit float target that could not be read back is still the table; filtered only where the GPU can)
      const lin = target.texture.type !== THREE.FloatType || gpuCaps.floatLinear;
      target.texture.minFilter = target.texture.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
      this.target = target;
      this.tex = target.texture;
    }
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
  }
}

/**
 * The table for the model and nature materials (shared uniform: those materials are cached for the page). The
 * renderer sets it; while it is null (preview pages, no game renderer yet) patched materials keep three's lookups.
 */
export const SCENE_ENV_LUT = { tEnvLut: { value: null as THREE.Texture | null } };

/**
 * three's diffuse image-based lighting of a lit model or nature material from the table (the same irradiance, one
 * texture fetch instead of textureCubeUV). Chains onto the material's own onBeforeCompile / program key.
 */
export function patchEnvLutIrradiance(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.envLut) return;
  mat.userData.envLut = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    if (!SCENE_ENV_LUT.tEnvLut.value) return;
    Object.assign(shader.uniforms, SCENE_ENV_LUT);
    shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', envLutChunk(false));
  };
  mat.customProgramCacheKey = () => `${prevKey()}|lut${SCENE_ENV_LUT.tEnvLut.value ? 1 : 0}`;
  mat.needsUpdate = true;
}

const _cam = new THREE.Camera();
