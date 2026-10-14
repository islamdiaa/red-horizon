import * as THREE from 'three';
import { FollowVolume } from './volume';
import { COLLAPSE, HEIGHT_GLSL } from './shaderlib';
import type { HeightField } from './heightfield';
import { Rng } from './rng';

/** Tileable 2-channel noise: R = soft fbm (billows), G = sharper ridged fbm (wisps). */
function makeNoiseTexture(size: number, seed: number): THREE.DataTexture {
  const rng = new Rng(seed);
  const octaves = [4, 8, 16, 32, 64];
  const lattices = octaves.map((p) => {
    const a = new Float32Array(p * p);
    for (let i = 0; i < a.length; i++) a[i] = rng.next();
    return a;
  });
  const lattices2 = octaves.map((p) => {
    const a = new Float32Array(p * p);
    for (let i = 0; i < a.length; i++) a[i] = rng.next();
    return a;
  });
  const sample = (lat: Float32Array, p: number, u: number, v: number) => {
    const x = u * p, y = v * p;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = lat[y0 * p + x0], b = lat[y0 * p + x1], c = lat[y1 * p + x0], d = lat[y1 * p + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  const data = new Uint8Array(size * size * 2);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      let s = 0, amp = 0.5, norm = 0, r = 0, ramp = 0.5;
      for (let o = 0; o < octaves.length; o++) {
        s += amp * sample(lattices[o], octaves[o], u, v);
        norm += amp;
        amp *= 0.5;
        const q = 1 - Math.abs(sample(lattices2[o], octaves[o], u, v) * 2 - 1);
        r += ramp * q * q;
        ramp *= 0.55;
      }
      const k = (j * size + i) * 2;
      data[k] = Math.max(0, Math.min(255, Math.round(((s / norm - 0.5) * 1.7 + 0.5) * 255)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round(Math.min(1, r * 1.35) * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Large soft ground-hugging billboards: they lie (nearly) flat at a few heights above the terrain,
 * drift with the wind and get their shape from scrolling world-space noise, so neighbouring puffs
 * merge into coherent banks. Each fragment compares its height with the terrain height texture to
 * fade softly where a hill pokes through. The same population morphs between fog banks, rain mist
 * and a sandstorm's dust streams by blending uniforms, so cross-fades are seamless.
 */
const VERT = /* glsl */ `
${HEIGHT_GLSL}
attribute vec4 aSeed;        // xy: normalised position, z: layer (0..1), w: rank
uniform vec3 uB;
uniform vec3 uAx;
uniform vec3 uAz;
uniform vec2 uCam2;
uniform vec4 uPh;            // drift phase: lane 0 (low) xy, lane 1 (high) zw
uniform float uSize;
uniform float uAniso;        // stretch along the wind
uniform vec2 uWindDir;
uniform vec2 uLayer;         // height above ground: low, high
uniform float uDensity;
uniform float uWater;
uniform float uValley;       // 0..1: how much valleys / water collect extra fog
uniform float uTilt;         // tilt the quads towards the camera (0 = flat)
uniform float uTime;
varying vec3 vWorld;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  float alpha = clamp((uDensity - aSeed.w) * 20.0, 0.0, 1.0);
  float lane = step(0.5, aSeed.z);
  vec2 n = fract(aSeed.xy + mix(uPh.xy, uPh.zw, lane) - uCam2);
  vec3 c = uB + uAx * (n.x - 0.5) + uAz * (n.y - 0.5);
  vec2 hh = wx_height(c.xz);
  float ground = max(max(hh.y, hh.x - 0.3), uWater);
  float valley = clamp((hh.y - hh.x) * 1.6, 0.0, 1.0) + step(hh.x, uWater - 0.05) * 0.8;
  alpha *= mix(1.0, 0.45 + valley * 1.1, uValley);
  vec2 e = min(n, 1.0 - n);
  alpha *= smoothstep(0.0, 0.14, min(e.x, e.y));
  if (alpha < 0.004) { ${COLLAPSE}; return; }
  float seed = fract(aSeed.x * 31.7 + aSeed.y * 17.3);
  float size = uSize * (0.7 + 0.6 * seed);
  vec2 wd = uWindDir;
  vec2 wp = vec2(-wd.y, wd.x);
  vec2 off = wd * (position.x * size * (1.0 + uAniso)) + wp * (position.y * size);
  float y = ground + mix(uLayer.x, uLayer.y, aSeed.z);
  // gentle tilt towards the camera so the banks read as volume rather than decals
  vec3 toCam = normalize(cameraPosition - c);
  vec3 world = vec3(c.x + off.x, y, c.z + off.y);
  float dToCam = dot(vec2(off.x, off.y), normalize(toCam.xz + 1e-4));
  world.y += dToCam * uTilt;
  vWorld = world;
  vUv = position.xy;
  vAlpha = alpha;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${HEIGHT_GLSL}
uniform sampler2D uNoise;
uniform mat2 uNoiseM;        // world xz -> noise uv (scale + wind-aligned stretch)
uniform vec4 uScroll;        // two noise scroll offsets
uniform vec3 uColor;         // lit colour (top)
uniform vec3 uShadow;        // lit colour (underside / thick parts)
uniform float uOpacity;
uniform float uWater;
uniform vec2 uShape;         // threshold low, high
varying vec3 vWorld;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main() {
  float r = length(vUv);
  float radial = 1.0 - smoothstep(0.15, 1.0, r);
  if (radial <= 0.0) discard;
  vec2 q = uNoiseM * vWorld.xz;
  float n1 = texture(uNoise, q + uScroll.xy + vSeed * 0.37).r;
  float n2 = texture(uNoise, q * 2.3 + uScroll.zw - vSeed * 0.21).g;
  float dens = smoothstep(uShape.x, uShape.y, n1 * 0.7 + n2 * 0.45 + radial * 0.35 - 0.25);
  float hg = max(wx_height(vWorld.xz).x, uWater);
  float soft = smoothstep(0.0, 0.55, vWorld.y - hg);
  float a = dens * radial * soft * vAlpha * uOpacity;
  if (a < 0.002) discard;
  vec3 col = mix(uShadow, uColor, clamp(n2 * 1.1 - dens * 0.3 + 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}
`;

export class HazeLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly volume = new FollowVolume();
  readonly max: number;
  readonly noise: THREE.DataTexture;
  readonly uniforms: {
    uB: { value: THREE.Vector3 };
    uAx: { value: THREE.Vector3 };
    uAz: { value: THREE.Vector3 };
    uCam2: { value: THREE.Vector2 };
    uPh: { value: THREE.Vector4 };
    uSize: { value: number };
    uAniso: { value: number };
    uWindDir: { value: THREE.Vector2 };
    uLayer: { value: THREE.Vector2 };
    uDensity: { value: number };
    uWater: { value: number };
    uValley: { value: number };
    uTilt: { value: number };
    uTime: { value: number };
    uNoiseM: { value: THREE.Matrix2 };
    uScroll: { value: THREE.Vector4 };
    uColor: { value: THREE.Color };
    uShadow: { value: THREE.Color };
    uOpacity: { value: number };
    uShape: { value: THREE.Vector2 };
  };

  constructor(max: number, seed: number, hf: HeightField, waterLevel: number) {
    this.max = max;
    const rng = new Rng(seed);
    this.noise = makeNoiseTexture(128, seed + 7);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 2, 1, 2, 3, 1]);
    const seeds = new Float32Array(max * 4);
    // stratified positions so the banks cover the area evenly
    const side = Math.ceil(Math.sqrt(max));
    for (let i = 0; i < max; i++) {
      const gx = i % side, gy = Math.floor(i / side) % side;
      seeds[i * 4] = (gx + rng.next()) / side;
      seeds[i * 4 + 1] = (gy + rng.next()) / side;
      seeds[i * 4 + 2] = rng.next();
      seeds[i * 4 + 3] = rng.next() * 0.98;
    }
    // sort by rank so density fades remove a random subset
    const order = Array.from({ length: max }, (_, i) => i).sort((a, b) => seeds[a * 4 + 3] - seeds[b * 4 + 3]);
    const sorted = new Float32Array(max * 4);
    order.forEach((src, dst) => {
      sorted.set(seeds.subarray(src * 4, src * 4 + 4), dst * 4);
      sorted[dst * 4 + 3] = (dst + 0.5) / max;
    });
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sorted, 4));
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = {
      uB: { value: this.volume.base },
      uAx: { value: new THREE.Vector3() },
      uAz: { value: new THREE.Vector3() },
      uCam2: { value: new THREE.Vector2() },
      uPh: { value: new THREE.Vector4() },
      uSize: { value: 6 },
      uAniso: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uLayer: { value: new THREE.Vector2(0.3, 1.6) },
      uDensity: { value: 0 },
      uWater: { value: waterLevel },
      uValley: { value: 1 },
      uTilt: { value: 0.15 },
      uTime: { value: 0 },
      uNoiseM: { value: new THREE.Matrix2() },
      uScroll: { value: new THREE.Vector4() },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uShadow: { value: new THREE.Color(0.6, 0.6, 0.6) },
      uOpacity: { value: 0.5 },
      uShape: { value: new THREE.Vector2(0.25, 0.85) },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'weather-haze',
      uniforms: { ...this.uniforms, uHeight: { value: hf.texture }, uHX: { value: hf.xform }, uNoise: { value: this.noise } },
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
    this.mesh.name = 'weather-haze';
  }

  private static readonly UP = new THREE.Vector3(0, 1, 0);

  setFrame(base: THREE.Vector3, ax: THREE.Vector3, az: THREE.Vector3): void {
    this.volume.setFrame(base, ax, az, HazeLayer.UP);
    this.uniforms.uAx.value.copy(ax);
    this.uniforms.uAz.value.copy(az);
    this.uniforms.uCam2.value.set(this.volume.cam.x, this.volume.cam.y);
  }

  /** Drift with a world velocity; lane 0 (low puffs) and lane 1 (high puffs) move at different speeds. */
  drift(vel: THREE.Vector3, dt: number, lanes: ArrayLike<number>): void {
    const v = this.volume;
    v.drift(vel, dt, lanes);
    this.uniforms.uPh.value.set(v.phX.x, v.phY.x, v.phX.y, v.phY.y);
  }

  setDensity(d: number): void {
    const dd = Math.max(0, Math.min(1, d));
    this.uniforms.uDensity.value = dd;
    this.geometry.instanceCount = dd > 0.002 ? Math.min(this.max, Math.ceil((dd + 0.05) * this.max)) : 0;
    this.mesh.visible = this.geometry.instanceCount > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.noise.dispose();
  }
}
