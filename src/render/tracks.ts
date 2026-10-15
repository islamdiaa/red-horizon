import * as THREE from 'three';
import { lerp } from '../core/util';
import { T, WATER_LEVEL } from '../sim/map';
import type { World } from '../sim/world';
import type { FogOfWar } from './fog';

const CAPACITY = 6000;
const LIFE = 45; // seconds until a mark has fully faded

/** Tyre / track marks pressed into the ground behind vehicles (one instanced draw call). */
export class TrackMarks {
  readonly mesh: THREE.InstancedMesh;
  private born: THREE.InstancedBufferAttribute;
  private strength: THREE.InstancedBufferAttribute;
  private next = 0;
  private last = new Map<number, [number, number]>();
  private dummy = new THREE.Object3D();
  private uTime = { value: 0 };
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  /** Slots ever written: only these are drawn. */
  private used = 0;
  private alive = new Set<number>();

  constructor(private world: World, private fog: FogOfWar) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.born = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY).fill(-1e6), 1);
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    this.born.setUsage(THREE.DynamicDrawUsage);
    this.strength.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBorn', this.born);
    geo.setAttribute('aStrength', this.strength);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uTime: this.uTime },
      vertexShader: /* glsl */ `
        attribute float aBorn;
        attribute float aStrength;
        uniform float uTime;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          float age = uTime - aBorn;
          vAlpha = aStrength * (1.0 - smoothstep(${(LIFE * 0.45).toFixed(1)}, ${LIFE.toFixed(1)}, age)) * smoothstep(0.0, 0.3, age);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          // tread pattern across the mark, soft edges along it
          float tread = 0.55 + 0.45 * step(0.5, fract(vUv.y * 3.0));
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          gl_FragColor = vec4(vec3(0.07, 0.05, 0.035), vAlpha * tread * edge);
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

  private add(x: number, y: number, yaw: number, width: number, length: number, strength: number, time: number) {
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
    const map = this.world.map;
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
      const soft = t === T.Sand || t === T.Dirt || map.ore[map.idx(cx, cy)] > 0 ? 1 : 0.6;
      const yaw = Math.atan2(dy, dx);
      const mx = (x + px) / 2, my = (y + py) / 2;
      const nx = -Math.sin(yaw), ny = Math.cos(yaw);
      const tracked = u.ut.tracked;
      const half = u.ut.radius * (tracked ? 0.62 : 0.55);
      const w = tracked ? 0.13 + u.ut.radius * 0.12 : 0.07;
      const s = (tracked ? 0.34 : 0.24) * soft;
      this.add(mx + nx * half, my + ny * half, yaw, w, dist + 0.04, s, time);
      this.add(mx - nx * half, my - ny * half, yaw, w, dist + 0.04, s, time);
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
      for (const a of [this.born, this.strength]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirtyFrom, this.dirtyTo - this.dirtyFrom + 1);
        a.needsUpdate = true;
      }
      this.dirtyFrom = Infinity;
      this.dirtyTo = -1;
    }
  }
}
