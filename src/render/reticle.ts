import * as THREE from 'three';
import type { GameMap } from '../sim/map';

/** Animated ground reticle for superweapon targeting (radius matches the weapon's area). */
export class TargetReticle {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(private map: GameMap) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 0.25, 0.15) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float ring = smoothstep(0.035, 0.0, abs(r - 0.96)) ;
          float inner = smoothstep(0.02, 0.0, abs(r - 0.55)) * 0.6;
          float pulse = smoothstep(0.03, 0.0, abs(r - fract(uTime * 0.6))) * 0.7 * (1.0 - r);
          float a = atan(p.y, p.x);
          float ticks = step(0.92, fract(a / 6.2831 * 24.0 + uTime * 0.2)) * smoothstep(0.82, 0.9, r) * step(r, 0.96);
          float cross = (smoothstep(0.012, 0.0, abs(p.x)) + smoothstep(0.012, 0.0, abs(p.y))) * step(r, 0.3) * step(0.08, r);
          float fill = (1.0 - r) * 0.08 * step(r, 1.0);
          float v = (ring + inner + pulse + ticks * 0.8 + cross + fill) * step(r, 1.0);
          gl_FragColor = vec4(uColor * 3.0 * v, v);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  show(x: number, y: number, radius: number, color: number, time: number) {
    this.mesh.visible = true;
    this.mesh.position.set(x, this.map.surfaceAt(x, y) + 0.08, y);
    this.mesh.scale.set(radius, 1, radius);
    this.mat.uniforms.uColor.value.set(color);
    this.mat.uniforms.uTime.value = time;
  }

  hide() {
    this.mesh.visible = false;
  }
}
