import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { getDummyShadowTexture, getNoiseTexture, TNOISE_GLSL } from './terrain';

/**
 * Shared cloud field (2D coverage drifting with the wind). The same function shades the cloud shadows on
 * the ground (atmosphere pass), the low cloud layer and the god rays through its gaps (volumetric pass).
 * uCloud: x coverage 0..1, y layer base height, z layer thickness, w shadow strength. uCloudOff: wind drift.
 * Needs TNOISE_GLSL first.
 */
export const CLOUD_GLSL = /* glsl */ `
uniform vec4 uCloud;
uniform vec2 uCloudOff;
float cloudCov(vec2 xz) {
  vec2 q = (xz + uCloudOff) * 0.021;
  float n = tn_fbm(q) * 0.7 + tn_fbm(q * 2.7 + vec2(4.7, 1.3)) * 0.3;
  float th = mix(0.66, 0.36, uCloud.x);
  return smoothstep(th - 0.05, th + 0.09, n);
}
float cloudShadowAt(vec3 P, vec3 sunDir) {
  float t = (uCloud.y + uCloud.z * 0.5 - P.y) / max(sunDir.y, 0.2);
  return cloudCov(P.xz + sunDir.xz * t) * uCloud.w;
}
`;

/**
 * Half-resolution raymarched participating media (high quality), composited by the atmosphere pass:
 *   - a weather fog layer (fog banks, storm haze) with 3D drifting density, lit by the sun through the
 *     shadow map (god rays carved by trees, buildings and units) and by the sky;
 *   - "air" below ~8 units that only shows where sunlight streams through: dawn / dusk light shafts, and rays
 *     through the gaps of the cloud layer;
 *   - a low cloud layer drifting with the wind, seen when the camera is zoomed far out (intro recon view);
 *     its shadows match the cloud shadows on the ground.
 * Output: rgb = in-scattered light, a = transmittance.
 */
export class VolumetricPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  depthSource: (() => THREE.Texture | null) | null = null;
  shadowLight: THREE.DirectionalLight | null = null;
  private frame = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.target.texture.name = 'volumetrics';
    this.material = new THREE.ShaderMaterial({
      name: 'volumetrics',
      uniforms: {
        tDepth: { value: null },
        tNoise: { value: getNoiseTexture() },
        tShadow: { value: getDummyShadowTexture() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowOn: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uFrame: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.3, 0.35, 0.4) },
        uFog: { value: new THREE.Vector4(0, 2.5, -0.5, 0.6) },
        uFogWind: { value: new THREE.Vector2() },
        uAir: { value: 0 },
        uCloud: { value: new THREE.Vector4(0.35, 17, 5, 0.4) },
        uCloudOff: { value: new THREE.Vector2() },
        uCloudDens: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth, tNoise;
        uniform sampler2DShadow tShadow;
        uniform mat4 uShadowMatrix, uProjInv, uCamWorld;
        uniform float uShadowOn, uTime, uFrame, uAir, uCloudDens;
        uniform vec3 uSunDir, uSunColor, uSky;
        uniform vec4 uFog;
        uniform vec2 uFogWind;
        varying vec2 vUv;
        ${TNOISE_GLSL}
        ${CLOUD_GLSL}
        // pseudo-3D value noise from two offset slices of the 2D noise texture
        float noise3(vec3 q) {
          float fy = floor(q.y), ty = q.y - fy;
          ty = ty * ty * (3.0 - 2.0 * ty);
          float a = tn_noise(q.xz + fy * vec2(37.1, 17.7));
          float b = tn_noise(q.xz + (fy + 1.0) * vec2(37.1, 17.7));
          return mix(a, b, ty);
        }
        float sunVis(vec3 p) {
          if (uShadowOn < 0.5) return 1.0;
          vec4 sc = uShadowMatrix * vec4(p, 1.0);
          bool inside = sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0;
          return inside ? texture(tShadow, vec3(sc.xy, sc.z - 0.0015)) : 1.0;
        }
        void main() {
          float depth = texture2D(tDepth, vUv).x;
          vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          view /= view.w;
          vec3 camPos = uCamWorld[3].xyz;
          vec3 world = (uCamWorld * view).xyz;
          vec3 rd = world - camPos;
          float rayLen = length(rd);
          rd /= rayLen;
          if (depth >= 0.99999) rayLen = 400.0;
          // interleaved gradient noise, rotated every frame (TAA / the eye averages it out)
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * vec2(5.588, 2.471), vec2(0.06711056, 0.00583715))));
          float mu = dot(rd, uSunDir);
          float phase = 0.5 + 1.2 * pow(max(mu, 0.0), 5.0);
          vec3 scat = vec3(0.0);
          float trans = 1.0;

          // ---- low cloud layer (only when the camera is well above it)
          float cTop = uCloud.y + uCloud.z;
          float cVis = uCloudDens * smoothstep(cTop + 3.0, cTop + 16.0, camPos.y);
          if (cVis > 0.002 && rd.y < -0.01) {
            float ta = max(0.0, (cTop - camPos.y) / rd.y);
            float tb = min(rayLen, (uCloud.y - camPos.y) / rd.y);
            if (tb > ta) {
              const int CN = 8;
              float ds = (tb - ta) / float(CN);
              for (int i = 0; i < CN; i++) {
                vec3 sp = camPos + rd * (ta + (float(i) + jit) * ds);
                float h = (sp.y - uCloud.y) / uCloud.z;
                float prof = smoothstep(0.0, 0.35, h) * smoothstep(1.0, 0.55, h);
                float cov = cloudCov(sp.xz);
                float det = 0.55 + 0.9 * noise3(sp * vec3(0.32, 0.5, 0.32) + vec3(uCloudOff.x * 0.3, uTime * 0.05, uCloudOff.y * 0.3));
                float sig = cVis * 0.9 * max(cov * prof * det - 0.08, 0.0);
                if (sig > 0.0) {
                  float tr = exp(-sig * ds);
                  // tops are sunlit, bottoms in their own shade
                  vec3 L = uSunColor * (0.35 + 0.65 * h) * phase * 0.16 + uSky * 0.4;
                  scat += trans * L * (1.0 - tr);
                  trans *= tr;
                }
              }
            }
          }

          // ---- fog layer and sunlit air near the ground
          float top = max(8.0, uFog.z + uFog.y * 3.0);
          if (trans > 0.01 && (uFog.x > 0.0005 || uAir > 0.0005)) {
            float ta = rd.y < -0.005 ? max(0.0, (top - camPos.y) / rd.y) : 0.0;
            float tb = rayLen;
            if (tb > ta) {
              const int FN = 14;
              float ds = (tb - ta) / float(FN);
              vec2 wind = uFogWind;
              for (int i = 0; i < FN; i++) {
                vec3 sp = camPos + rd * (ta + (float(i) + jit) * ds);
                float fog = uFog.x * exp(-max(sp.y - uFog.z, -2.0) / uFog.y);
                fog *= 1.0 - uFog.w + uFog.w * 2.0 * noise3(sp * vec3(0.11, 0.3, 0.11) + vec3(wind.x, uTime * 0.03, wind.y));
                float air = uAir * smoothstep(top, top * 0.45, sp.y);
                float sig = fog + air;
                if (sig <= 0.0) continue;
                float vis = sunVis(sp);
                float cs = 1.0 - cloudShadowAt(sp, uSunDir);
                vec3 sunL = uSunColor * vis * cs * phase * 0.12;
                // fog is lit by sky and sun; the thin air only shows where the sun streams through
                vec3 L = (sunL + uSky * 0.32) * fog + sunL * vis * air * 2.0;
                float tr = exp(-sig * ds);
                scat += trans * (L / sig) * (1.0 - tr);
                trans *= tr;
              }
            }
          }
          gl_FragColor = vec4(scat, trans);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }

  render(renderer: THREE.WebGLRenderer) {
    const u = this.material.uniforms;
    u.tDepth.value = this.depthSource?.() ?? null;
    const sl = this.shadowLight;
    if (sl && sl.castShadow && sl.shadow.map) {
      u.tShadow.value = sl.shadow.map.depthTexture;
      u.uShadowMatrix.value.copy(sl.shadow.matrix);
      u.uShadowOn.value = 1;
    }
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uFrame.value = this.frame = (this.frame + 1) % 64;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
