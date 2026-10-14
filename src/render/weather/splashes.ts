import * as THREE from 'three';
import { FollowVolume } from './volume';
import { COLLAPSE, HASH_GLSL, HEIGHT_GLSL } from './shaderlib';
import type { HeightField } from './heightfield';
import { Rng } from './rng';

/**
 * Rain impacts: a pool of instances that each re-spawn every ~0.7-1.2 s at a hashed position in a
 * camera-following ground rectangle. The vertex shader looks the ground height up in the height
 * texture: on land an instance draws a quick splash ring plus a tiny crown of droplets, on water
 * it draws an expanding double ripple ring. Zero per-frame CPU work besides a few uniforms.
 */
const VERT = /* glsl */ `
${HASH_GLSL}
${HEIGHT_GLSL}
attribute vec4 aSeed;     // x: phase, y: -, z: period jitter, w: rank
uniform vec3 uB;
uniform vec3 uAx;
uniform vec3 uAz;
uniform vec2 uCam2;
uniform float uTime;
uniform float uDensity;
uniform float uWater;
uniform vec3 uSize;       // ring radius, ripple radius, crown half-width
varying vec2 vUv;
varying float vLife;
varying float vType;      // 0 ground ring, 1 water ripple, 2 droplet crown
varying float vAlpha;
varying vec3 vRnd;

void main() {
  float alpha = clamp((uDensity - aSeed.w) * 30.0, 0.0, 1.0);
  float period = 0.7 + aSeed.z * 0.5;
  float tt = uTime / period + aSeed.x * 13.0;
  float cyc = floor(tt);
  float secs = fract(tt) * period;
  uint k = uint(gl_InstanceID) * 0x9E3779B1u + uint(cyc) * 0x85EBCA77u;
  vec2 n = fract(vec2(wx_h(k), wx_h(k ^ 0x68E31DA4u)) - uCam2);
  vec3 wp = uB + uAx * (n.x - 0.5) + uAz * (n.y - 0.5);
  float h = wx_height(wp.xz).x;
  vRnd = vec3(wx_h(k + 11u), wx_h(k + 12u), wx_h(k + 13u));
  bool crown = position.z > 0.5;
  vec3 world;
  if (h < uWater - 0.02) {
    float dur = 0.65 + 0.3 * vRnd.y;
    vLife = secs / dur;
    if (crown || vLife >= 1.0 || alpha < 0.004 || vRnd.z > 0.45) { ${COLLAPSE}; return; }
    vType = 1.0;
    float R = uSize.y * (0.7 + 0.6 * vRnd.x);
    world = vec3(wp.x + position.x * R, uWater + 0.015, wp.z + position.y * R);
  } else {
    float dur = crown ? 0.3 : 0.24;
    vLife = secs / dur;
    if (vLife >= 1.0 || alpha < 0.004 || (crown && vRnd.z < 0.35)) { ${COLLAPSE}; return; }
    if (!crown) {
      vType = 0.0;
      float R = uSize.x * (0.7 + 0.6 * vRnd.x);
      world = vec3(wp.x + position.x * R, h + 0.06, wp.z + position.y * R);
    } else {
      vType = 2.0;
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      float W = uSize.z * (0.8 + 0.4 * vRnd.y);
      world = vec3(wp.x, h + 0.02, wp.z) + right * (position.x * W) + vec3(0.0, position.y * W * 1.3, 0.0);
    }
  }
  vUv = position.xy;
  vAlpha = alpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vLife;
varying float vType;
varying float vAlpha;
varying vec3 vRnd;
void main() {
  float a = 0.0;
  float L = vLife;
  if (vType < 0.5) {
    // splash ring + bright impact point
    float r = length(vUv);
    float e = 1.0 - (1.0 - L) * (1.0 - L);
    float R = mix(0.1, 0.85, e);
    float w = mix(0.22, 0.08, L);
    float x = (r - R) / w;
    a = exp(-x * x) * (1.0 - L) * 0.55;
    a += exp(-r * r * 60.0) * (1.0 - smoothstep(0.0, 0.3, L)) * 0.7;
  } else if (vType < 1.5) {
    // water: expanding double ripple
    float r = length(vUv);
    float e = sqrt(L);
    float w = 0.06 + 0.06 * L;
    float x1 = (r - e) / w;
    float R2 = e - 0.35;
    float x2 = (r - R2) / w;
    a = exp(-x1 * x1) + 0.45 * step(0.0, R2) * exp(-x2 * x2);
    a *= pow(1.0 - L, 2.0) * (1.0 - smoothstep(0.85, 1.0, r)) * 0.5;
    a += exp(-r * r * 90.0) * (1.0 - smoothstep(0.0, 0.15, L)) * 0.8;
  } else {
    // droplet crown: a few drops thrown up and out on parabolas
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float hx = fract(vRnd.x * 7.13 + fi * 0.618);
      float hy = fract(vRnd.y * 3.71 + fi * 0.382);
      float dx = (hx * 2.0 - 1.0) * L * 0.9;
      float dy = 3.2 * L * (1.0 - L) * (0.4 + 0.6 * hy);
      vec2 d = vec2(vUv.x - dx, (vUv.y - dy) * 1.3);
      a += 1.0 - smoothstep(0.05, 0.14, length(d));
    }
    a *= (1.0 - L * L) * 0.9;
  }
  a *= vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a * 0.4);
}
`;

export class SplashLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly volume = new FollowVolume();
  readonly max: number;
  readonly uniforms: {
    uB: { value: THREE.Vector3 };
    uAx: { value: THREE.Vector3 };
    uAz: { value: THREE.Vector3 };
    uCam2: { value: THREE.Vector2 };
    uTime: { value: number };
    uDensity: { value: number };
    uWater: { value: number };
    uSize: { value: THREE.Vector3 };
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
  };

  constructor(max: number, seed: number, hf: HeightField, waterLevel: number) {
    this.max = max;
    const rng = new Rng(seed);
    const g = new THREE.InstancedBufferGeometry();
    // quad 0: horizontal ring (-1..1)^2, quad 1: vertical crown billboard x -1..1, y 0..1
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0,
      -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1,
    ], 3));
    g.setIndex([0, 2, 1, 2, 3, 1, 4, 5, 6, 6, 5, 7]);
    const seeds = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) {
      seeds[i * 4] = rng.next();
      seeds[i * 4 + 1] = rng.next();
      seeds[i * 4 + 2] = rng.next();
      seeds[i * 4 + 3] = (i + 0.5) / max;
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = {
      uB: { value: this.volume.base },
      uAx: { value: new THREE.Vector3() },
      uAz: { value: new THREE.Vector3() },
      uCam2: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uDensity: { value: 0 },
      uWater: { value: waterLevel },
      uSize: { value: new THREE.Vector3(0.17, 0.3, 0.13) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.5 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'weather-splash',
      uniforms: { ...this.uniforms, uHeight: { value: hf.texture }, uHX: { value: hf.xform } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.name = 'weather-splash';
  }

  private static readonly UP = new THREE.Vector3(0, 1, 0);

  /** Footprint on the ground: centre `base`, edge vectors ax (screen-right) and az (screen-up). */
  setFrame(base: THREE.Vector3, ax: THREE.Vector3, az: THREE.Vector3): void {
    this.volume.setFrame(base, ax, az, SplashLayer.UP);
    this.uniforms.uAx.value.copy(ax);
    this.uniforms.uAz.value.copy(az);
    this.uniforms.uCam2.value.set(this.volume.cam.x, this.volume.cam.y);
  }

  setDensity(d: number): void {
    const dd = Math.max(0, Math.min(1, d));
    this.uniforms.uDensity.value = dd;
    this.geometry.instanceCount = dd > 0.002 ? Math.min(this.max, Math.ceil((dd + 0.04) * this.max)) : 0;
    this.mesh.visible = this.geometry.instanceCount > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
