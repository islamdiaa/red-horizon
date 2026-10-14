import * as THREE from 'three';
import type { World } from '../sim/world';
import type { FogOfWar } from './fog';

/** Bobbing, glowing bonus crates. */
export class CrateRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private boxGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  private strapGeo = new THREE.BoxGeometry(0.36, 0.06, 0.36);
  private wood = new THREE.MeshStandardMaterial({ color: 0x8a6236, roughness: 0.8 });
  private strap = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, metalness: 0.8, roughness: 0.35, emissive: new THREE.Color(0.9, 0.7, 0.2), emissiveIntensity: 0.6 });
  private haloGeo = new THREE.RingGeometry(0.22, 0.42, 32).rotateX(-Math.PI / 2);
  private haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.6), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });

  constructor(private world: World, private fog: FogOfWar) {}

  update(time: number) {
    const seen = new Set<number>();
    for (const c of this.world.crates) {
      seen.add(c.id);
      let g = this.meshes.get(c.id);
      if (!g) {
        g = new THREE.Group();
        const box = new THREE.Mesh(this.boxGeo, this.wood);
        box.castShadow = true;
        const s1 = new THREE.Mesh(this.strapGeo, this.strap);
        const s2 = new THREE.Mesh(this.strapGeo, this.strap);
        s2.rotation.x = Math.PI / 2;
        const inner = new THREE.Group();
        inner.add(box, s1, s2);
        inner.name = 'inner';
        const halo = new THREE.Mesh(this.haloGeo, this.haloMat);
        halo.name = 'halo';
        g.add(inner, halo);
        this.group.add(g);
        this.meshes.set(c.id, g);
      }
      const h = this.world.map.surfaceAt(c.x, c.y);
      g.position.set(c.x, h, c.y);
      const inner = g.getObjectByName('inner')!;
      inner.position.y = 0.32 + Math.sin(time * 2 + c.id) * 0.06;
      inner.rotation.y = time * 0.8 + c.id;
      const halo = g.getObjectByName('halo')!;
      halo.position.y = 0.03;
      halo.scale.setScalar(1 + Math.sin(time * 3 + c.id) * 0.15);
      g.visible = this.fog.exploredAt(c.x, c.y) > 0.5;
    }
    for (const [id, g] of this.meshes) {
      if (!seen.has(id)) { this.group.remove(g); this.meshes.delete(id); }
    }
  }
}
