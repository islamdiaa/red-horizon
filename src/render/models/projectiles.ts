/**
 * Projectile models (face +X, origin at the projectile centre). Geometry/materials are shared;
 * each call only creates a few Mesh objects.
 */
import * as THREE from 'three';
import type { ProjectileModelKind } from './types';
import { NB, instantiate, makeTemplate, type ModelTemplate } from './builder';
import { M, G, lathe, prismXY } from './parts';

const NEUTRAL = new THREE.Color(0x8a8a8a);
const cache = new Map<ProjectileModelKind, ModelTemplate>();

function fins(nb: NB, x0: number, len: number, h: number, mat = M.dark): void {
  for (let i = 0; i < 4; i++) {
    nb.add(
      prismXY(
        [
          [x0, 0],
          [x0 + len, 0],
          [x0 + len * 0.3, h],
          [x0, h],
        ],
        0.004,
        0,
      ),
      mat,
      { r: [(i * Math.PI) / 2 + Math.PI / 4, 0, 0] },
    );
  }
}

function flame(nb: NB, x: number, r: number, len: number): void {
  nb.add(new THREE.ConeGeometry(r, len, 10), G.fire, { p: [x - len / 2, 0, 0], r: [0, 0, Math.PI / 2], slot: 'glow' });
  nb.add(new THREE.ConeGeometry(r * 0.55, len * 0.6, 8), G.white, { p: [x - len * 0.3 - 0.002, 0, 0], r: [0, 0, Math.PI / 2], slot: 'glow' });
}

function build(kind: ProjectileModelKind): ModelTemplate {
  const r = new NB('root');
  let glow = 4;
  switch (kind) {
    case 'shell': {
      r.add(new THREE.CapsuleGeometry(0.022, 0.1, 4, 8), { glow: 0xffd890 }, { r: [0, 0, Math.PI / 2] });
      r.add(new THREE.ConeGeometry(0.018, 0.12, 8), { glow: 0xff9a40, i: 0.6 }, { p: [-0.11, 0, 0], r: [0, 0, Math.PI / 2] });
      glow = 5;
      break;
    }
    case 'missile': {
      r.cyl(M.offwhite, 0.018, 0.018, 0.2, 0, 0, 0, { r: [0, 0, -Math.PI / 2], seg: 8 });
      r.add(lathe([[0.018, 0], [0.012, 0.03], [0.0, 0.055]], 8), M.red, { p: [0.1, 0, 0], r: [0, 0, -Math.PI / 2] });
      fins(r, -0.1, 0.05, 0.03);
      flame(r, -0.1, 0.016, 0.09);
      break;
    }
    case 'scud': {
      const R = 0.045;
      for (let q = 0; q < 4; q++) {
        const g = new THREE.CylinderGeometry(R, R * 0.92, 0.36, 6, 1, false, (q * Math.PI) / 2 + Math.PI / 4, Math.PI / 2);
        r.add(g, q % 2 ? M.black : M.white, { p: [-0.02, 0, 0], r: [0, 0, -Math.PI / 2] });
      }
      r.add(lathe([[R, 0], [R * 0.9, 0.05], [R * 0.5, 0.12], [0.003, 0.17]], 12), M.red, { p: [0.16, 0, 0], r: [0, 0, -Math.PI / 2] });
      fins(r, -0.24, 0.12, 0.08, M.black);
      flame(r, -0.2, 0.04, 0.22);
      break;
    }
    case 'grenade': {
      r.sph(M.oliveDark, 0.03, 0, 0, 0, { seg: 10, s: [1.15, 1, 1] });
      r.cyl(M.dark, 0.031, 0.031, 0.01, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 10 });
      r.box(M.steel, 0.02, 0.012, 0.01, 0.02, 0.028, 0, { b: 0 });
      break;
    }
    case 'nuke': {
      const R = 0.07;
      r.cyl(M.white, R, R, 0.56, -0.05, 0, 0, { r: [0, 0, -Math.PI / 2], seg: 16 });
      r.add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.05, 16), M.yellow, { p: [0.12, 0, 0], r: [0, 0, -Math.PI / 2] });
      r.add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.03, 16), M.dark, { p: [-0.25, 0, 0], r: [0, 0, -Math.PI / 2] });
      r.add(lathe([[R, 0], [R * 0.92, 0.08], [R * 0.6, 0.18], [0.005, 0.27]], 16), M.red, { p: [0.23, 0, 0], r: [0, 0, -Math.PI / 2] });
      // radiation trefoil hint (yellow band with dark dots)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        r.box(M.black, 0.03, 0.02, 0.006, 0.0, Math.cos(a) * R, Math.sin(a) * R, { b: 0, r: [a, 0, 0] });
      }
      fins(r, -0.33, 0.16, 0.12, M.dark);
      flame(r, -0.33, 0.06, 0.3);
      break;
    }
    case 'fireball': {
      r.sph({ glow: 0xffd070 }, 0.055, 0, 0, 0, { seg: 12 });
      r.sph({ glow: 0xff6010, i: 0.7 }, 0.08, -0.03, 0, 0, { seg: 12, s: [1.4, 1, 1] });
      r.add(new THREE.PlaneGeometry(0.4, 0.4), M.dark, { slot: 'fx:add:ff7018:2.5', keepUv: true, r: [-Math.PI / 2, 0, 0] });
      r.add(new THREE.PlaneGeometry(0.4, 0.4), M.dark, { slot: 'fx:add:ff7018:2.5', keepUv: true });
      glow = 5;
      break;
    }
  }
  return makeTemplate({ root: r, height: 0.1, radius: 0.1, muzzles: [], glow: { glow } });
}

export function createProjectile(kind: ProjectileModelKind): THREE.Object3D {
  let t = cache.get(kind);
  if (!t) {
    t = build(kind);
    cache.set(kind, t);
  }
  const inst = instantiate(t, NEUTRAL, `proj:${kind}`);
  inst.root.traverse((o) => {
    // projectiles are tiny and fast: no shadow receiving; casting only for big rockets
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.receiveShadow = false;
      m.castShadow = kind === 'scud' || kind === 'nuke';
    }
  });
  return inst.root;
}
