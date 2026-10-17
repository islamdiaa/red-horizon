import * as THREE from 'three';
import { lerp } from '../core/util';
import type { World } from '../sim/world';
import type { EntityRenderer } from './entities';
import type { DynamicLights } from './dynlights';
import { visualScale } from './scale';

/**
 * Fake light pools on the ground (one instanced draw call): warm floodlights around
 * powered structures and headlight beams in front of vehicles. Used at night.
 */
export class LightPools {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(private world: World, private ents: EntityRenderer, capacity = 600) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false; // static, identity transform (instances carry the placement)
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.renderOrder = 1;
  }

  update(alpha: number, time: number, strength = 1) {
    const w = this.world;
    const map = w.map;
    // with the renderer's dynamic lights (medium / high) floodlights and headlights really light the
    // ground, units and buildings around them; low keeps the cheap additive pools
    const dyn = this.mesh.parent?.userData.dynamicLights as DynamicLights | undefined;
    if (dyn && dyn.cap >= 100) {
      this.mesh.count = 0;
      for (const b of w.buildings) {
        if (!b.alive || b.buildAnim < 1 || !this.ents.isShown(b.id)) continue;
        const on = !b.owner.lowPower || b.bt.power > 0;
        const flicker = on ? 1 : 0.25 + 0.15 * Math.sin(time * 9 + b.id);
        const r = Math.max(b.w, b.h) * 1.15 + 2.4;
        dyn.add(b.x, map.surfaceAt(b.x, b.y) + 1.5 + Math.max(b.w, b.h) * 0.25, b.y + b.h * 0.3, 0xffbf73, 3 * strength * flicker, r, 0, { priority: 0.5 });
      }
      for (const u of w.units) {
        if (!u.alive || u.kind !== 'vehicle' || !this.ents.isShown(u.id)) continue;
        const x = lerp(u.prevX, u.x, alpha), y = lerp(u.prevY, u.y, alpha);
        const h = u.heading, c = Math.cos(h), sn = Math.sin(h);
        // from the front of the (visually scaled) hull
        const vs = visualScale('vehicle', u.type.id);
        const ahead = u.ut.radius * 0.9 * vs;
        dyn.add(x + c * ahead, map.surfaceAt(x, y) + 0.42 * vs, y + sn * ahead, 0xdce6ff, 0.9 * strength, 3.6, 0, { priority: 0.4, spot: { x: c, y: -0.32, z: sn, angle: 0.9 } });
      }
      return;
    }
    const d = this.dummy;
    let n = 0;
    const cap = this.mesh.instanceMatrix.count;
    const push = (x: number, y: number, sx: number, sz: number, rot: number, r: number, gc: number, b: number) => {
      if (n >= cap) return;
      d.position.set(x, map.surfaceAt(x, y) + 0.03, y);
      d.rotation.set(0, rot, 0);
      d.scale.set(sx, 1, sz);
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.color.setRGB(r * strength, gc * strength, b * strength);
      this.mesh.setColorAt(n, this.color);
      n++;
    };
    for (const b of w.buildings) {
      if (!b.alive || b.buildAnim < 1 || !this.ents.isShown(b.id)) continue;
      const on = !b.owner.lowPower || b.bt.power > 0;
      const flicker = on ? 1 : 0.25 + 0.15 * Math.sin(time * 9 + b.id);
      const s = Math.max(b.w, b.h) * 1.7 + 0.5;
      push(b.x, b.y + b.h * 0.15, s, s, 0, 0.3 * flicker, 0.17 * flicker, 0.06 * flicker);
    }
    for (const u of w.units) {
      if (!u.alive || u.kind !== 'vehicle' || !this.ents.isShown(u.id)) continue;
      const x = lerp(u.prevX, u.x, alpha), y = lerp(u.prevY, u.y, alpha);
      const h = u.heading;
      const ahead = 0.75 + u.ut.radius * visualScale('vehicle', u.type.id); // scaled hull
      push(x + Math.cos(h) * ahead, y + Math.sin(h) * ahead, 0.75, 1.3, -h + Math.PI / 2, 0.3, 0.32, 0.36);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
