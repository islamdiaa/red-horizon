/**
 * Iron Curtain shimmer shells: a tiny pool of fresnel sphere meshes (only drawn while active).
 */
import * as THREE from 'three';
import { premultipliedMaterialFlags } from './particles';

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
uniform sampler2D uNoise;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(1.0 - ndv, 2.2);
  float n = texture2D(uNoise, vP.xz * 0.9 + vec2(uTime * 0.11, vP.y * 0.7 - uTime * 0.17)).r;
  float bands = 0.5 + 0.5 * sin(vP.y * 22.0 - uTime * 9.0 + n * 6.0);
  float a = (fres * 1.3 + 0.06 + 0.12 * bands * fres) * (0.55 + 0.8 * n) * uAlpha;
  gl_FragColor = vec4(uColor * a, 0.0);
}
`;

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  start: number;
  life: number;
  radius: number;
  active: boolean;
}

export class ShellPool {
  readonly group = new THREE.Group();
  private shells: Shell[] = [];
  private geo = new THREE.SphereGeometry(1, 40, 20);

  constructor(count: number, noise: THREE.Texture, renderOrder: number) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(3.2, 0.25, 0.18) },
          uNoise: { value: noise },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
      });
      premultipliedMaterialFlags(mat);
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      this.group.add(mesh);
      this.shells.push({ mesh, mat, start: 0, life: 0, radius: 1, active: false });
    }
  }

  spawn(now: number, x: number, y: number, z: number, radius: number, life = 1.6): void {
    let best = this.shells[0];
    for (const s of this.shells) {
      if (!s.active) { best = s; break; }
      if (s.start < best.start) best = s;
    }
    best.active = true;
    best.start = now;
    best.life = life;
    best.radius = radius;
    best.mesh.position.set(x, y, z);
    best.mesh.visible = true;
  }

  update(now: number): void {
    for (const s of this.shells) {
      if (!s.active) continue;
      const age = now - s.start;
      if (age >= s.life || age < 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const t = age / s.life;
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.3), 3);
      const r = s.radius * (0.55 + 0.5 * grow);
      s.mesh.scale.set(r, r * 0.92, r);
      const fadeIn = Math.min(1, age / 0.08);
      const fadeOut = 1 - t * t;
      s.mat.uniforms.uAlpha.value = fadeIn * fadeOut * (0.85 + 0.15 * Math.sin(age * 40));
      s.mat.uniforms.uTime.value = now;
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const s of this.shells) s.mat.dispose();
    this.group.removeFromParent();
  }
}
