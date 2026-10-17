import * as THREE from 'three';
import type { GameMap } from '../sim/map';

const FLOCKS = 4;
const BIRDS_PER = 8;
const FIREFLIES = 420;

interface Flock { cx: number; cz: number; vx: number; vz: number; r: number; alt: number; phase: number; panic: number }

/**
 * Small touches of life: bird flocks wheeling over the battlefield by day (they scatter from
 * explosions) and fireflies drifting over meadows at night. Two draw calls.
 */
export class AmbientLife {
  readonly group = new THREE.Group();
  private birds: THREE.InstancedMesh;
  private flies: THREE.Points;
  private flocks: Flock[] = [];
  private dummy = new THREE.Object3D();
  private uTime = { value: 0 };
  private uNight = { value: 0 };
  private flyBase: Float32Array;

  constructor(private map: GameMap, private heightAt: (x: number, y: number) => number) {
    // a bird: body + two wings; wings flap in the vertex shader (x>0 = right wing tip)
    const pos = new Float32Array([
      // left wing
      0, 0, -0.03, 0, 0, 0.03, -0.32, 0.02, 0.08,
      // right wing
      0, 0, 0.03, 0, 0, -0.03, 0.32, 0.02, 0.08,
      // body
      0, -0.01, -0.12, 0.03, 0, 0.06, -0.03, 0, 0.06,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3;
          float flap = sin(uTime * 11.0 + ph) * 0.9 + 0.2;
          transformed.y += abs(transformed.x) * flap;`);
    };
    this.birds = new THREE.InstancedMesh(geo, mat, FLOCKS * BIRDS_PER);
    this.birds.castShadow = true;
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
    for (let f = 0; f < FLOCKS; f++) {
      this.flocks.push({ cx: map.w * Math.random(), cz: map.h * Math.random(), vx: 0, vz: 0, r: 2 + Math.random() * 2, alt: 4.5 + Math.random() * 3, phase: Math.random() * 6, panic: 0 });
    }

    // fireflies: points that blink and drift
    const fp = new Float32Array(FIREFLIES * 3);
    const seed = new Float32Array(FIREFLIES);
    this.flyBase = new Float32Array(FIREFLIES * 2);
    for (let i = 0; i < FIREFLIES; i++) { seed[i] = Math.random(); }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const fmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uTime, uNight: this.uNight },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 40.0;
          p.x += sin(t * 1.3) * 0.35; p.z += cos(t * 1.1) * 0.35; p.y += sin(t * 2.1) * 0.12;
          float blink = smoothstep(0.55, 1.0, sin(uTime * (0.8 + aSeed * 1.4) + aSeed * 60.0));
          vA = blink;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.2 + 1.6 * blink) * (38.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          float a = smoothstep(0.25, 0.0, d) * vA * uNight;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.3, 1.8, 0.5) * a, a);
        }`,
    });
    this.flies = new THREE.Points(fgeo, fmat);
    this.flies.frustumCulled = false;
    this.group.add(this.flies);
  }

  /** Startle birds near an explosion. */
  startle(x: number, z: number, strength: number) {
    for (const f of this.flocks) {
      const dx = f.cx - x, dz = f.cz - z;
      const d = Math.hypot(dx, dz);
      if (d < 10 * strength) {
        f.panic = 1;
        f.vx += (dx / (d + 0.1)) * 6 * strength;
        f.vz += (dz / (d + 0.1)) * 6 * strength;
      }
    }
  }

  update(dt: number, time: number, night: number, focusX: number, focusZ: number) {
    this.uTime.value = time;
    this.uNight.value = Math.max(0, (night - 0.35) / 0.65);
    const day = night < 0.6;
    this.birds.visible = day;
    const d = this.dummy;
    if (day) {
      let k = 0;
      for (const f of this.flocks) {
        // wander towards the camera area so birds are actually seen, with some independence
        const tx = focusX + Math.sin(time * 0.05 + f.phase) * 18, tz = focusZ + Math.cos(time * 0.04 + f.phase * 1.7) * 14;
        f.vx += ((tx - f.cx) * 0.02 - f.vx * 0.3) * dt;
        f.vz += ((tz - f.cz) * 0.02 - f.vz * 0.3) * dt;
        f.cx += f.vx * dt;
        f.cz += f.vz * dt;
        f.panic = Math.max(0, f.panic - dt * 0.3);
        const alt = f.alt + f.panic * 3;
        for (let b = 0; b < BIRDS_PER; b++) {
          const a = time * (0.6 + f.panic) + f.phase + (b / BIRDS_PER) * Math.PI * 2;
          const rr = f.r * (0.6 + 0.4 * Math.sin(b * 1.7 + time * 0.3)) * (1 + f.panic);
          const x = f.cx + Math.cos(a) * rr, z = f.cz + Math.sin(a) * rr * 0.7;
          d.position.set(x, Math.max(alt, this.heightAt(x, z) + 3) + Math.sin(time * 0.7 + b) * 0.3, z);
          d.rotation.set(0, -a - Math.PI / 2 + Math.PI, Math.sin(time + b) * 0.2);
          d.scale.setScalar(0.85 + (b % 3) * 0.12);
          d.updateMatrix();
          this.birds.setMatrixAt(k++, d.matrix);
        }
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
    // fireflies hover over meadows near the camera focus
    this.flies.visible = this.uNight.value > 0.01 && this.map.climate !== 'winter'; // no fireflies over snow
    if (this.flies.visible) {
      const pos = this.flies.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const R = 22;
      let moved = false;
      for (let i = 0; i < FIREFLIES; i++) {
        let bx = this.flyBase[i * 2], bz = this.flyBase[i * 2 + 1];
        if (Math.abs(bx - focusX) > R || Math.abs(bz - focusZ) > R || (bx === 0 && bz === 0)) {
          // respawn over grass near the camera
          for (let tries = 0; tries < 4; tries++) {
            bx = focusX + (Math.random() * 2 - 1) * R;
            bz = focusZ + (Math.random() * 2 - 1) * R;
            const cx = Math.floor(bx), cz = Math.floor(bz);
            if (this.map.inBounds(cx, cz) && this.map.terrain[this.map.idx(cx, cz)] === 0) break;
          }
          this.flyBase[i * 2] = bx;
          this.flyBase[i * 2 + 1] = bz;
          arr[i * 3] = bx;
          arr[i * 3 + 1] = this.heightAt(bx, bz) + 0.25 + Math.random() * 0.6;
          arr[i * 3 + 2] = bz;
          moved = true;
        }
      }
      if (moved) pos.needsUpdate = true;
    }
  }
}
