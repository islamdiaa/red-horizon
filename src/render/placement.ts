import * as THREE from 'three';
import { BUILDINGS, WEAPONS } from '../data/rules';
import type { GameMap } from '../sim/map';
import { createModel } from './models';
import { createHoloMaterial } from './holo';
import type { ModelInstance } from './models/types';

/** Holographic building preview with per-cell validity tiles and a weapon-range ring. */
export class PlacementGhost {
  readonly group = new THREE.Group();
  private model: ModelInstance | null = null;
  private typeId: string | null = null;
  private tiles: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private holo: THREE.ShaderMaterial;
  private tileColor = new THREE.Color();

  constructor(private map: GameMap) {
    this.holo = createHoloMaterial();
    const tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    const tileMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tiles = new THREE.InstancedMesh(tileGeo, tileMat, 16);
    this.tiles.count = 0;
    this.tiles.renderOrder = 3;
    this.tiles.frustumCulled = false;
    this.group.add(this.tiles);
    const ringGeo = new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.visible = false;
    this.group.add(this.ring);
    this.group.visible = false;
  }

  get active() {
    return this.typeId !== null;
  }

  set(typeId: string | null, teamColor?: THREE.Color) {
    if (typeId === this.typeId) return;
    if (this.model) { this.model.dispose(); this.model = null; }
    this.typeId = typeId;
    this.group.visible = !!typeId;
    if (!typeId) return;
    this.model = createModel(typeId, teamColor ?? new THREE.Color(0x4080ff));
    this.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = this.holo; m.castShadow = false; m.receiveShadow = false; }
    });
    this.group.add(this.model.root);
    const bt = BUILDINGS[typeId];
    const w = bt.primary ? WEAPONS[bt.primary] : null;
    this.ring.visible = !!w;
    if (w) this.ring.scale.set(w.range + Math.max(bt.size[0], bt.size[1]) / 2, 1, w.range + Math.max(bt.size[0], bt.size[1]) / 2);
  }

  /** Position at footprint top-left (cx, cy). cellOk(i) = validity per footprint cell. */
  update(cx: number, cy: number, cellOk: (dx: number, dy: number) => boolean, valid: boolean, time: number) {
    if (!this.typeId || !this.model) return;
    const bt = BUILDINGS[this.typeId];
    const [w, h] = bt.size;
    const x = cx + w / 2, y = cy + h / 2;
    const g = this.map.heightAt(x, y);
    this.model.root.position.set(x, g, y);
    this.holo.uniforms.uTime.value = time;
    this.holo.uniforms.uColor.value.set(valid ? 0x40d8ff : 0xff4030);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const tx = cx + dx + 0.5, ty = cy + dy + 0.5;
      m.makeTranslation(tx, this.map.heightAt(tx, ty) + 0.05, ty);
      this.tiles.setMatrixAt(k, m);
      const ok = cellOk(dx, dy) && valid;
      this.tileColor.set(ok ? 0x30ff70 : 0xff3020);
      this.tiles.setColorAt(k, this.tileColor);
      k++;
    }
    this.tiles.count = k;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    this.ring.position.set(x, g + 0.08, y);
  }
}
