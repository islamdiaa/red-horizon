import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, ORE_MAX } from '../sim/map';
import { flat } from './geomutil';

function lumpy(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  const p = m.attributes.position;
  const n = new Noise2D(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (n.value(x * 9 + y * 3, z * 9 - y * 5) - 0.5) * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  m.computeVertexNormals();
  return flat(m);
}

function goldCluster(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [[0, 0, 0.11], [0.13, 0.05, 0.085], [-0.1, 0.09, 0.08], [0.04, -0.13, 0.075]];
  spots.forEach(([x, z, r], k) => {
    const g = lumpy(new THREE.IcosahedronGeometry(r, 0), 0.45, 100 + k);
    g.scale(1, 0.7, 1);
    g.translate(x, r * 0.45, z);
    parts.push(g);
  });
  return mergeGeometries(parts)!;
}

function gemCluster(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const g = new THREE.OctahedronGeometry(0.07, 0);
    g.scale(0.8, 2.6 + hash2(k, 1) * 1.2, 0.8);
    const a = (k / n) * Math.PI * 2;
    const tilt = k === 0 ? 0 : 0.45;
    g.rotateZ(Math.cos(a) * tilt);
    g.rotateX(Math.sin(a) * tilt);
    const r = k === 0 ? 0 : 0.08;
    g.translate(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    parts.push(flat(g));
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

const SPARKLE_VERT = `
  varying float vSpark;
  uniform float uTime;
`;

function sparkleMaterial(params: THREE.MeshStandardMaterialParameters, uTime: { value: number }, sparkleColor: THREE.Color, key: string, intensity: number) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uSparkColor = { value: sparkleColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SPARKLE_VERT)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = fract(sin(dot(ip.xz + transformed.xz * 13.0, vec2(12.9898, 78.233))) * 43758.5453);
          vSpark = pow(max(0.0, sin(uTime * (0.7 + ph * 1.5) + ph * 40.0)), 60.0) * step(0.7, ph);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSpark;\nuniform vec3 uSparkColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uSparkColor * vSpark * ${intensity.toFixed(2)};`);
  };
  mat.customProgramCacheKey = () => 'ore-' + key;
  return mat;
}

export class OreRenderer {
  readonly group = new THREE.Group();
  readonly uTime = { value: 0 };
  private gold!: THREE.InstancedMesh;
  private gems!: THREE.InstancedMesh;
  private goldGeo = goldCluster();
  private gemGeo = gemCluster();
  private goldMat: THREE.MeshStandardMaterial;
  private gemMat: THREE.MeshStandardMaterial;
  private lastVersion = -1;
  private timer = 0;
  private dummy = new THREE.Object3D();

  constructor(private map: GameMap, private heightAt: (x: number, y: number) => number) {
    this.goldMat = sparkleMaterial({
      color: new THREE.Color(0.62, 0.42, 0.12), metalness: 0.7, roughness: 0.42,
      emissive: new THREE.Color(0.3, 0.16, 0.02), emissiveIntensity: 0.12,
    }, this.uTime, new THREE.Color(3, 2.4, 1.2), 'gold', 1.0);
    this.gemMat = sparkleMaterial({
      color: new THREE.Color(0.55, 0.55, 0.55), metalness: 0.25, roughness: 0.12,
      emissive: new THREE.Color(0, 0, 0), transparent: false,
    }, this.uTime, new THREE.Color(1.6, 1.6, 1.8), 'gem', 1.0);
    // gems glow softly in their own colour (instance colour)
    this.gemMat.onBeforeCompile = ((orig) => (shader: any, r: any) => {
      orig(shader, r);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_INSTANCING_COLOR
          totalEmissiveRadiance += vColor * 0.22;
        #endif`);
    })(this.gemMat.onBeforeCompile);
    this.allocate(Math.max(64, map.oreFieldCells.length * 3 + 64));
    this.sync(true);
  }

  private allocate(capacity: number) {
    for (const m of [this.gold, this.gems]) if (m) { this.group.remove(m); m.dispose(); }
    this.gold = new THREE.InstancedMesh(this.goldGeo, this.goldMat, capacity);
    this.gems = new THREE.InstancedMesh(this.gemGeo, this.gemMat, capacity);
    for (const m of [this.gold, this.gems]) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    this.gems.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  update(dt: number, time: number) {
    this.uTime.value = time;
    this.timer -= dt;
    if (this.timer <= 0 && this.map.oreVersion !== this.lastVersion) {
      this.timer = 0.25;
      this.sync(false);
    }
  }

  private sync(force: boolean) {
    if (!force && this.map.oreVersion === this.lastVersion) return;
    this.lastVersion = this.map.oreVersion;
    const m = this.map;
    const cells = m.oreFieldCells;
    if (cells.length * 3 > this.gold.instanceMatrix.count) this.allocate(cells.length * 3 + 128);
    let gi = 0, ei = 0;
    const d = this.dummy;
    const gemColors = GEM_COLORS;
    for (const ci of cells) {
      const amt = m.ore[ci];
      if (!amt) continue;
      const cx = ci % m.w, cy = (ci / m.w) | 0;
      const isGem = m.gems[ci] === 1;
      const pieces = amt >= 6 ? 2 : 1;
      for (let k = 0; k < pieces; k++) {
        const x = cx + 0.18 + hash2(cx, cy, 10 + k) * 0.64;
        const y = cy + 0.18 + hash2(cx, cy, 20 + k) * 0.64;
        const s = (0.45 + (amt / ORE_MAX) * 0.6) * (k === 0 ? 1.1 : 0.7) * (0.85 + hash2(cx, cy, 30 + k) * 0.3) * (isGem ? 0.75 : 1);
        d.position.set(x, this.heightAt(x, y) - 0.015, y);
        d.rotation.set((hash2(cx, cy, 40 + k) - 0.5) * 0.3, hash2(cx, cy, 50 + k) * 6.28, (hash2(cx, cy, 60 + k) - 0.5) * 0.3);
        d.scale.set(s, s, s);
        d.updateMatrix();
        if (isGem) {
          this.gems.setMatrixAt(ei, d.matrix);
          this.gems.setColorAt(ei, gemColors[Math.floor(hash2(cx, cy, 70 + k) * gemColors.length)]);
          ei++;
        } else {
          this.gold.setMatrixAt(gi++, d.matrix);
        }
      }
    }
    this.gold.count = gi;
    this.gems.count = ei;
    this.gold.visible = gi > 0;
    this.gems.visible = ei > 0;
    this.gold.instanceMatrix.needsUpdate = true;
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
  }
}

const GEM_COLORS = [new THREE.Color(0.05, 0.75, 1.0), new THREE.Color(0.85, 0.1, 0.75), new THREE.Color(0.15, 0.9, 0.35), new THREE.Color(1.0, 0.15, 0.12)];
