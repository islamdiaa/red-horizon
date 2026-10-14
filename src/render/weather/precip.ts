import * as THREE from 'three';
import { FollowVolume } from './volume';
import { COLLAPSE, HASH_GLSL, VOLUME_GLSL } from './shaderlib';
import { Rng } from './rng';

export type PrecipMode = 'rain' | 'snow' | 'grit';
const MODE_ID: Record<PrecipMode, number> = { rain: 0, snow: 1, grit: 2 };

const VERT = /* glsl */ `
${HASH_GLSL}
${VOLUME_GLSL}
attribute vec4 aSeed;          // xyz: normalised start position, w: rank (0..1) for density fades
uniform vec4 uLaneSpeed;       // speed factor per lane (matches the CPU drift lanes)
uniform vec3 uVel;             // world velocity of lane 1.0 (units/s)
uniform float uStreak;         // motion-blur exposure (s): streak length = |v| * uStreak
uniform float uWidth;          // world width of a streak / diameter of a flake
uniform float uSizeVar;
uniform float uMinPx;          // minimum drawn half-width in pixels (thin lines get alpha instead)
uniform vec2 uRes;             // drawing buffer size in pixels
uniform float uDensity;        // 0..1, fraction of particles shown
uniform vec2 uNear;            // fade particles out between these distances to the camera
uniform float uTime;
uniform vec4 uTurb;            // amplitude, frequency, updraft, -
varying vec2 vLocal;           // pixels: x along the streak from the head, y across
varying float vLen;
varying float vHalfW;
varying float vAlpha;
varying float vShade;

void main() {
  vec3 rnd = wx_rand3(aSeed.xyz);
  vec4 lm = wx_lane(rnd.x);
  vec3 p = wx_vol(wx_norm(aSeed.xyz, lm));
  vec3 vel = uVel * dot(uLaneSpeed, lm);
  float size = uWidth * (1.0 + uSizeVar * (rnd.y * 2.0 - 1.0));
  float alpha = clamp((uDensity - aSeed.w) * 30.0, 0.0, 1.0);
#if MODE == 1
  // snow: lazy, per-flake swirling plus tumbling (flat flakes flicker in size and brightness)
  float f = uTurb.y * (0.55 + 0.9 * rnd.y);
  float ph = rnd.z * 6.2831;
  float t = uTime * f + ph;
  vec3 sw = vec3(sin(t), 0.3 * sin(t * 1.7 + ph), cos(t * 0.83 + ph * 1.3));
  p += sw * uTurb.x;
  vel += vec3(cos(t), 0.51 * cos(t * 1.7 + ph), -0.83 * sin(t * 0.83 + ph * 1.3)) * uTurb.x * f;
  float tumble = 0.55 + 0.45 * abs(sin(uTime * (1.5 + 2.5 * rnd.z) + ph * 3.0));
  size *= tumble;
  vShade = tumble;
#elif MODE == 2
  // grit: fast eddies swirling around the wind direction
  float f = uTurb.y * (0.6 + 0.8 * rnd.y);
  float ph = rnd.z * 6.2831;
  float t = uTime * f + ph;
  float amp = uTurb.x * (0.4 + 0.6 * rnd.z);
  p += vec3(sin(t) * amp, (0.5 + 0.5 * sin(t * 0.7 + ph)) * uTurb.z, cos(t) * amp);
  vel += vec3(cos(t), 0.35 * cos(t * 0.7 + ph), -sin(t)) * amp * f;
  vShade = rnd.y;
#else
  vShade = rnd.y;
#endif
  alpha *= smoothstep(uNear.x, uNear.y, distance(p, cameraPosition));
  vec3 tail = p - vel * uStreak;
  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (alpha < 0.004 || c0.w < 0.5 || c1.w < 0.5) { ${COLLAPSE}; return; }
  vec2 hr = uRes * 0.5;
  vec2 s0 = c0.xy / c0.w * hr;
  vec2 s1 = c1.xy / c1.w * hr;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hwPx = 0.5 * size * projectionMatrix[1][1] * hr.y / c0.w;
  float hw = max(hwPx, uMinPx);
  alpha *= hwPx / hw;   // energy-preserving: sub-pixel streaks are drawn wider but fainter
  float along = position.x;
  vec2 sp = mix(s0 - dir * hw, s1 + dir * hw, along) + nrm * (position.y * hw);
  float z = mix(c0.z / c0.w, c1.z / c1.w, along);
  // a single w for all corners keeps the varyings linear in screen space
  gl_Position = vec4(sp / hr * c0.w, z * c0.w, c0.w);
  vLocal = vec2(mix(-hw, len + hw, along), position.y * hw);
  vLen = len;
  vHalfW = hw;
  vAlpha = alpha;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uOccl;        // how much the particle occludes what is behind (alpha channel factor)
varying vec2 vLocal;
varying float vLen;
varying float vHalfW;
varying float vAlpha;
varying float vShade;
void main() {
  float t = clamp(vLocal.x, 0.0, vLen);
  vec2 d = vec2(vLocal.x - t, vLocal.y) / vHalfW;
  float r2 = dot(d, d);
  float k = t / max(vLen, 1.0);   // 0 at the head (leading end), 1 at the tail
  float a;
  vec3 col = uColor;
#if MODE == 0
  a = exp(-r2 * 2.6) * (1.0 - 0.8 * k) ;
  col *= 0.85 + 0.3 * vShade;
#elif MODE == 1
  float r = sqrt(r2);
  a = 1.0 - smoothstep(0.25, 1.0, r);
  col *= 0.8 + 0.3 * vShade + 0.25 * (1.0 - r);
#else
  a = exp(-r2 * 2.2) * (1.0 - 0.6 * k);
  col *= 0.7 + 0.6 * vShade;
#endif
  a *= vAlpha * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, a * uOccl);
}
`;

/** Rain streaks, snow flakes or wind-blown grit in a camera-following volume. One draw call. */
export class PrecipLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly volume = new FollowVolume();
  readonly max: number;
  readonly uniforms: {
    uLaneSpeed: { value: THREE.Vector4 };
    uVel: { value: THREE.Vector3 };
    uStreak: { value: number };
    uWidth: { value: number };
    uSizeVar: { value: number };
    uMinPx: { value: number };
    uRes: { value: THREE.Vector2 };
    uDensity: { value: number };
    uNear: { value: THREE.Vector2 };
    uTime: { value: number };
    uTurb: { value: THREE.Vector4 };
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
    uOccl: { value: number };
  };
  readonly lanes: number[];

  constructor(readonly mode: PrecipMode, max: number, seed: number, res: THREE.Vector2) {
    this.max = max;
    const rng = new Rng(seed);
    const g = new THREE.InstancedBufferGeometry();
    // corner quad: x = along (0 head .. 1 tail), y = side (-1 .. 1)
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) {
      seeds[i * 4] = rng.next();
      seeds[i * 4 + 1] = rng.next();
      seeds[i * 4 + 2] = rng.next();
      seeds[i * 4 + 3] = (i + 0.5) / max; // rank: the first k instances are drawn for density k/max
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    this.geometry = g;
    this.lanes = mode === 'rain' ? [0.86, 0.95, 1.05, 1.14] : mode === 'snow' ? [0.7, 0.9, 1.1, 1.3] : [0.7, 0.9, 1.1, 1.3];
    this.uniforms = {
      uLaneSpeed: { value: new THREE.Vector4(...this.lanes) },
      uVel: { value: new THREE.Vector3() },
      uStreak: { value: 0.035 },
      uWidth: { value: 0.02 },
      uSizeVar: { value: 0.3 },
      uMinPx: { value: 0.65 },
      uRes: { value: res },
      uDensity: { value: 0 },
      uNear: { value: new THREE.Vector2(4, 9) },
      uTime: { value: 0 },
      uTurb: { value: new THREE.Vector4() },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.35 },
      uOccl: { value: 0.3 },
    };
    this.material = new THREE.ShaderMaterial({
      name: `weather-${mode}`,
      defines: { MODE: MODE_ID[mode] },
      uniforms: { ...this.uniforms, ...this.volume.uniforms() },
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
    this.mesh.name = `weather-${mode}`;
  }

  /** Set the fraction of particles shown (0..1); hides the mesh entirely at 0. */
  setDensity(d: number): void {
    const dd = Math.max(0, Math.min(1, d));
    this.uniforms.uDensity.value = dd;
    // draw a few beyond the fade edge so particles fade in smoothly instead of popping
    this.geometry.instanceCount = dd > 0.002 ? Math.min(this.max, Math.ceil((dd + 0.04) * this.max)) : 0;
    this.mesh.visible = this.geometry.instanceCount > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
