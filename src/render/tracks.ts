import * as THREE from 'three';
import { lerp } from '../core/util';
import { T, WATER_LEVEL } from '../sim/map';
import type { World } from '../sim/world';
import type { FogOfWar } from './fog';

const CAPACITY = 6000;
const LIFE = 45; // seconds until a mark has fully faded
/** Ruts in snow and sand stay longer than marks on hard ground. */
const SOFT_LIFE = 80;

/** Rut look per instance: 0 = hard ground / grass (dark print), 1 = sand (berms), 2 = snow (bluish grooves, bright rims). */
const KIND_HARD = 0;
const KIND_SAND = 1;
const KIND_SNOW = 2;

/**
 * Tyre / track marks pressed into the ground behind vehicles (one instanced draw call).
 *
 * Marks are drawn as ruts: a groove profile across the track (darker floor, lit and shadowed walls toward /
 * away from the sun, raised berms at the edges) with the tread cleats pressed in. They blend "2x multiply"
 * (result = 2 · mark · ground), so they darken and brighten whatever the lit ground already is, by day and by
 * night alike. Snow (winter maps, or fresh snowfall from the weather) gets deep bluish grooves with bright
 * berms, sand soft berms, hard ground a darker print.
 */
export class TrackMarks {
  readonly mesh: THREE.InstancedMesh;
  private born: THREE.InstancedBufferAttribute;
  private strength: THREE.InstancedBufferAttribute;
  private kind: THREE.InstancedBufferAttribute;
  private next = 0;
  private last = new Map<number, [number, number]>();
  private dummy = new THREE.Object3D();
  private uTime = { value: 0 };
  private uSun = { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() };
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  /** Slots ever written: only these are drawn. */
  private used = 0;
  private alive = new Set<number>();
  /** Weather snow cover 0..1 (fresh snow makes new marks snow ruts); see setWeather. */
  private wxSnow: { value: number } | null = null;
  /** Rendered terrain with persistent ruts (FX terrain.rut): soft ground keeps the grooves after the prints fade. */
  private terrain: { rut?(x0: number, y0: number, x1: number, y1: number, width: number, depth?: number): void } | null = null;

  constructor(private world: World, private fog: FogOfWar) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.born = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY).fill(-1e6), 1);
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    this.kind = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    for (const a of [this.born, this.strength, this.kind]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBorn', this.born);
    geo.setAttribute('aStrength', this.strength);
    geo.setAttribute('aKind', this.kind);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // 2x multiply: 0.5 leaves the ground as it is, darker digs in, brighter raises a berm
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: { uTime: this.uTime, uSun: this.uSun },
      vertexShader: /* glsl */ `
        attribute float aBorn;
        attribute float aStrength;
        attribute float aKind;
        uniform float uTime;
        uniform vec3 uSun;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vKind;
        varying float vSunSide;
        void main() {
          vUv = uv;
          float age = uTime - aBorn;
          float life = aKind > 0.5 ? ${SOFT_LIFE.toFixed(1)} : ${LIFE.toFixed(1)};
          vAlpha = aStrength * (1.0 - smoothstep(life * 0.45, life, age)) * smoothstep(0.0, 0.3, age);
          vKind = aKind;
          // which side of the rut faces the sun: its across-track axis (local x) against the sun's heading
          vec3 across = normalize(mat3(instanceMatrix) * vec3(1.0, 0.0, 0.0));
          vec2 sun = normalize(uSun.xz + vec2(1e-4));
          vSunSide = dot(across.xz, sun);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vAlpha;
        varying float vKind;
        varying float vSunSide;
        void main() {
          float x = vUv.x * 2.0 - 1.0;            // -1 .. 1 across the rut
          float ax = abs(x);
          float floorK = 1.0 - smoothstep(0.35, 0.8, ax);                 // groove floor
          float wall = smoothstep(0.3, 0.75, ax) * (1.0 - smoothstep(0.75, 0.92, ax));
          float berm = smoothstep(0.78, 0.9, ax) * (1.0 - smoothstep(0.9, 1.0, ax));
          float cleat = step(0.5, fract(vUv.y * 3.0));                    // tread pressed into the floor
          // the wall facing the sun is lit, the other in shadow
          float lit = wall * sign(x) * clamp(vSunSide * 2.0, -1.0, 1.0);
          vec3 c;
          if (vKind > 1.5) {
            // snow: deep bluish groove, crisp bright berms
            float d = floorK * (0.8 + 0.2 * cleat);
            c = vec3(0.5) - vec3(0.13, 0.12, 0.085) * d + vec3(0.1) * berm + vec3(0.08) * lit;
          } else if (vKind > 0.5) {
            // sand: soft groove, raised berms, a darker damp floor
            float d = floorK * (0.8 + 0.2 * cleat);
            c = vec3(0.5) - vec3(0.15, 0.17, 0.19) * d + vec3(0.08, 0.075, 0.06) * berm + vec3(0.07) * lit;
          } else {
            // hard ground / grass: a dark print with tread
            float d = floorK * (0.55 + 0.45 * cleat);
            c = vec3(0.5) - vec3(0.3, 0.31, 0.32) * d + vec3(0.04) * berm + vec3(0.03) * lit;
          }
          float edge = smoothstep(1.0, 0.92, ax);
          gl_FragColor = vec4(mix(vec3(0.5), c, clamp(vAlpha, 0.0, 1.0) * edge), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false; // static, identity transform (instances carry the placement)
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.visible = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, zero);
  }

  private touch(a: THREE.InstancedBufferAttribute) {
    a.clearUpdateRanges();
    a.addUpdateRange(this.dirtyFrom, this.dirtyTo - this.dirtyFrom + 1);
    a.needsUpdate = true;
  }

  /** The rendered terrain: snow, sand and mud also get persistent ruts pressed into it (FX's terrain.rut). */
  setTerrain(t: { rut?(x0: number, y0: number, x1: number, y1: number, width: number, depth?: number): void } | null): void {
    this.terrain = t;
  }

  /** Weather surface uniforms (uWxSnow): marks laid in fresh snow become snow ruts. */
  setWeather(u: { uWxSnow: { value: number } } | null): void {
    this.wxSnow = u?.uWxSnow ?? null;
  }

  private add(x: number, y: number, yaw: number, width: number, length: number, strength: number, kind: number, time: number) {
    const map = this.world.map;
    const h = map.heightAt(x, y);
    if (h < WATER_LEVEL + 0.02) return;
    const d = this.dummy;
    d.position.set(x, h + 0.015, y);
    d.rotation.set(0, -yaw + Math.PI / 2, 0);
    d.scale.set(width, 1, length);
    d.updateMatrix();
    const i = this.next;
    this.mesh.setMatrixAt(i, d.matrix);
    (this.born.array as Float32Array)[i] = time;
    (this.strength.array as Float32Array)[i] = strength;
    (this.kind.array as Float32Array)[i] = kind;
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i);
    if (i + 1 > this.used) {
      this.used = i + 1;
      this.mesh.count = this.used;
      this.mesh.visible = true;
    }
    this.next = (this.next + 1) % CAPACITY;
    if (this.next === 0) { this.dirtyFrom = 0; this.dirtyTo = CAPACITY - 1; }
  }

  update(alpha: number, time: number) {
    this.uTime.value = time;
    const sun = this.mesh.parent?.userData.sunDir as THREE.Vector3 | undefined;
    if (sun) this.uSun.value.copy(sun);
    const map = this.world.map;
    const winter = map.climate === 'winter';
    const snowing = (this.wxSnow?.value ?? 0) > 0.35;
    for (const u of this.world.units) {
      if (!u.alive || u.kind !== 'vehicle') continue;
      const x = lerp(u.prevX, u.x, alpha), y = lerp(u.prevY, u.y, alpha);
      const prev = this.last.get(u.id);
      if (!prev) { this.last.set(u.id, [x, y]); continue; }
      const dx = x - prev[0], dy = y - prev[1];
      const dist = Math.hypot(dx, dy);
      if (dist < 0.2) continue;
      const px = prev[0], py = prev[1];
      prev[0] = x;
      prev[1] = y;
      if (dist > 1.5) continue; // teleported / spawned
      if (this.fog.exploredAt(x, y) < 0.5) continue;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (!map.inBounds(cx, cy)) continue;
      const t = map.terrain[map.idx(cx, cy)];
      if (t === T.Rock || t === T.Water) continue;
      const sandy = t === T.Sand;
      const kind = winter || snowing ? KIND_SNOW : sandy ? KIND_SAND : KIND_HARD;
      const soft = kind !== KIND_HARD || t === T.Dirt || map.ore[map.idx(cx, cy)] > 0 ? 1 : 0.6;
      const yaw = Math.atan2(dy, dx);
      const mx = (x + px) / 2, my = (y + py) / 2;
      const nx = -Math.sin(yaw), ny = Math.cos(yaw);
      const tracked = u.ut.tracked;
      const half = u.ut.radius * (tracked ? 0.62 : 0.55);
      // ruts are wider than the print itself (berms either side)
      const w = (tracked ? 0.13 + u.ut.radius * 0.12 : 0.07) * (kind === KIND_HARD ? 1 : 1.15);
      // with the terrain pressing the persistent groove into soft ground, the prints only add the tread
      const rut = this.terrain?.rut && (kind !== KIND_HARD || t === T.Dirt);
      if (rut) this.terrain!.rut!(px, py, x, y, half * 2, tracked ? 0.85 : 0.5);
      const s = (tracked ? 0.85 : 0.6) * soft * (kind === KIND_SNOW ? 1.1 : 1) * (rut ? 0.6 : 1);
      this.add(mx + nx * half, my + ny * half, yaw, w, dist + 0.04, s, kind, time);
      this.add(mx - nx * half, my - ny * half, yaw, w, dist + 0.04, s, kind, time);
    }
    // forget dead vehicles occasionally
    if (this.last.size > this.world.units.length + 64) {
      const alive = this.alive;
      alive.clear();
      for (const u of this.world.units) alive.add(u.id);
      for (const id of this.last.keys()) if (!alive.has(id)) this.last.delete(id);
    }
    if (this.dirtyTo >= 0) {
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(this.dirtyFrom * 16, (this.dirtyTo - this.dirtyFrom + 1) * 16);
      im.needsUpdate = true;
      this.touch(this.born);
      this.touch(this.strength);
      this.touch(this.kind);
      this.dirtyFrom = Infinity;
      this.dirtyTo = -1;
    }
  }
}
