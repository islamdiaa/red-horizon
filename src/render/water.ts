import * as THREE from 'three';
import { GameMap, WATER_LEVEL } from '../sim/map';
import { NOISE_GLSL } from './terrain';

/** Animated stylised water surface with depth tint, shore foam, fresnel and sun glints. */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(map: GameMap, heightAt: (x: number, y: number) => number, sunDir: THREE.Vector3) {
    // height texture (one texel per 0.5 cell) used for depth-based shading
    const res = 2;
    const tw = map.w * res + 1, th = map.h * res + 1;
    const data = new Float32Array(tw * th);
    let minX = map.w, minY = map.h, maxX = 0, maxY = 0;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const h = heightAt(i / res, j / res);
      data[j * tw + i] = h;
      if (h < WATER_LEVEL + 0.05) {
        minX = Math.min(minX, i / res); maxX = Math.max(maxX, i / res);
        minY = Math.min(minY, j / res); maxY = Math.max(maxY, j / res);
      }
    }
    const tex = new THREE.DataTexture(data, tw, th, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    if (maxX < minX) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
    maxX = Math.min(map.w, maxX + 1); maxY = Math.min(map.h, maxY + 1);
    const geo = new THREE.PlaneGeometry(maxX - minX, maxY - minY, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, WATER_LEVEL, (minY + maxY) / 2);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: tex },
        uMapSize: { value: new THREE.Vector2(map.w, map.h) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
        uSky: { value: new THREE.Color(0.22, 0.38, 0.58) },
        uHorizon: { value: new THREE.Color(0.5, 0.56, 0.6) },
        uDeep: { value: new THREE.Color(0.008, 0.045, 0.075) },
        uShallow: { value: new THREE.Color(0.03, 0.16, 0.18) },
        uWaterLevel: { value: WATER_LEVEL },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uHeight;
        uniform vec2 uMapSize;
        uniform vec3 uSunDir, uSunColor, uSky, uHorizon, uDeep, uShallow;
        uniform float uWaterLevel;
        varying vec3 vWPos;
        ${NOISE_GLSL}
        float waves(vec2 p) {
          float t = uTime;
          return rh_noise(p * 1.3 + vec2(t * 0.35, t * 0.2)) * 0.6
               + rh_noise(p * 3.1 - vec2(t * 0.25, -t * 0.4)) * 0.3
               + rh_noise(p * 7.0 + vec2(-t * 0.6, t * 0.5)) * 0.1;
        }
        void main() {
          vec2 uv = vWPos.xz / uMapSize;
          float ground = texture2D(uHeight, uv).r;
          float depth = uWaterLevel - ground;
          if (depth < -0.02) discard;
          vec2 p = vWPos.xz;
          float e = 0.05;
          float w0 = waves(p), wx = waves(p + vec2(e, 0.0)), wz = waves(p + vec2(0.0, e));
          vec3 N = normalize(vec3(-(wx - w0) / e * 0.18, 1.0, -(wz - w0) / e * 0.18));
          vec3 V = normalize(cameraPosition - vWPos);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 refl = mix(uHorizon, uSky, clamp(reflect(-V, N).y * 1.6, 0.0, 1.0));
          float d = clamp(depth / 0.5, 0.0, 1.0);
          vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d));
          // caustic shimmer in the shallows
          float caus = pow(rh_noise(p * 4.0 + vec2(uTime * 0.5, uTime * 0.3)) * rh_noise(p * 4.7 - vec2(uTime * 0.4, -uTime * 0.2)), 2.0);
          body += vec3(0.25, 0.4, 0.35) * caus * (1.0 - d) * 0.6;
          float diff = max(dot(N, uSunDir), 0.0);
          vec3 col = body * (0.55 + 0.45 * diff);
          col = mix(col, refl * 0.8, clamp(fres * 0.8 + 0.06, 0.0, 1.0));
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 380.0);
          col += uSunColor * spec * 9.0;
          // shore foam: animated bands that wash up on the beach
          float band = sin(depth * 34.0 - uTime * 2.2 + rh_noise(p * 2.0) * 6.0) * 0.5 + 0.5;
          float foam = smoothstep(0.16, 0.0, depth) * (0.55 + 0.45 * band);
          foam *= smoothstep(0.25, 0.7, rh_noise(p * 6.0 + uTime * 0.3) + 0.35);
          col = mix(col, vec3(0.92, 0.95, 0.95), clamp(foam, 0.0, 1.0) * 0.85);
          float alpha = clamp(0.72 + d * 0.28 + fres * 0.3 + foam, 0.0, 0.98);
          alpha *= smoothstep(-0.02, 0.03, depth);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }
}
