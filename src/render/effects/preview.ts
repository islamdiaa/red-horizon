/**
 * Effects preview / test bed (preview-effects.html).
 *
 * URL params:
 *   only=all|explosions|projectiles|beams|emitters|decals|misc|markers|<ExplosionKind>|tracer|tesla|flame
 *        naval   – ships with wakes & bow spray, 8-inch shells, torpedoes, depth charges, splashes, sonar
 *        powers  – GPS launch, gap generator domes, radar jammer, Badger bombing run with contrails,
 *                  paratroopers, mines, camo pillbox, U2 flyover
 *        bridges – stone arch / sandstone / steel truss bridges, damage, collapse + rebuild
 *   t=SECONDS   fast-forward the simulation (fixed 1/60 steps) and freeze there (add play=1 to continue)
 *   dist=N      camera distance (default depends on scenario), cx/cz camera target
 *   seed=N      random seed (default 1) for repeatable screenshots
 *   bench=1     CPU benchmark of the effects system (results logged with console.warn)
 *   hud=0       hide overlay text
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ExplosionKind, ProjectileKind } from '../../data/rules';
import type { EmitterHandle, ProjectileHandle } from './types';
import { Effects } from './index';
import { seedRandom } from './rand';
import { WATER_LEVEL, GameMap } from '../../sim/map';
import { Water } from '../water';
import { createModel } from '../models';
import type { ModelAnimState, ModelInstance } from '../models/types';
import { ShipWakes, type WakeShip } from '../wakes';
import { GapField, type GapSource } from '../gapfield';
import { BridgeRenderer, type BridgeState, type BridgeClimate } from '../bridges';

const params = new URLSearchParams(location.search);
const only = params.get('only') ?? 'all';
const tTarget = params.has('t') ? parseFloat(params.get('t')!) : -1;
const play = params.get('play') === '1';
const bench = params.get('bench') === '1';
const showHud = params.get('hud') !== '0';
seedRandom(parseInt(params.get('seed') ?? '1', 10));

// deterministic helper RNG for the scenario itself (separate from the effects RNG)
let sseed = 12345;
function srnd(): number {
  sseed = (sseed * 16807) % 2147483647;
  return (sseed - 1) / 2147483646;
}
const sspread = (r: number) => (srnd() * 2 - 1) * r;

// ---------------------------------------------------------------------------------------------
// Terrain

/** Round-4 scenarios live in map space around (32, 32) so the real Water renderer can be used. */
const WATER_SCENES = ['naval', 'bridges', 'powers'];
const WATERY = WATER_SCENES.includes(only);
const OX = 32;
const OZ = 32;

function baseHeight(x: number, z: number): number {
  return 0.22 * Math.sin(x * 0.23) * Math.cos(z * 0.19) + 0.14 * Math.sin(x * 0.071 + z * 0.113) + 0.05 * Math.sin(x * 0.9 + 1.3) * Math.sin(z * 0.7);
}

/** 0..1 water mask for the round-4 scenes (lake / river / channel). */
function waterMask(x: number, z: number): number {
  const sm = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  if (only === 'naval') {
    const d = Math.hypot((x - OX) / 12.5, (z - OZ + 0.5) / 7.5) + 0.04 * Math.sin(x * 1.3) * Math.cos(z * 0.9);
    return sm(1.0, 0.82, d);
  }
  if (only === 'bridges') {
    const river = Math.abs(z - (OZ - 0.5) - 0.5 * Math.sin(x * 0.25));
    const channel = x > OX + 9.5 && x < OX + 16 ? Math.abs(x - (OX + 12.5)) : 99;
    return Math.max(sm(2.6, 1.6, river), sm(2.4, 1.4, channel));
  }
  if (only === 'powers') {
    const d = Math.hypot((x - (OX + 12)) / 4, (z - (OZ + 7)) / 3);
    return sm(1.0, 0.7, d);
  }
  return 0;
}

/** Ground / seabed height. */
function terrainH(x: number, z: number): number {
  const h = baseHeight(x, z);
  if (!WATERY) return h;
  const land = h * 0.6 + 0.02;
  return land + (WATER_LEVEL - 0.42 - land) * waterMask(x, z);
}

/** Surface height (never below the water) — what the game hands the effects system. */
function getHeight(x: number, z: number): number {
  const h = terrainH(x, z);
  return WATERY ? Math.max(h, WATER_LEVEL) : h;
}

const EXPLOSION_KINDS: ExplosionKind[] = ['piff', 'small', 'medium', 'large', 'huge', 'fire', 'electric', 'building', 'nuke'];
const defaultDist: Record<string, number> = { nuke: 36, all: 30, building: 20, naval: 21, bridges: 20, powers: 22 };
const dist = params.has('dist') ? parseFloat(params.get('dist')!) : defaultDist[only] ?? (EXPLOSION_KINDS.includes(only as ExplosionKind) ? 16 : 26);
const target = new THREE.Vector3(
  parseFloat(params.get('cx') ?? (WATERY ? String(OX) : '0')),
  0,
  parseFloat(params.get('cz') ?? (only === 'nuke' ? '-3' : WATERY ? String(OZ) : '0')),
);

// ---------------------------------------------------------------------------------------------
// Renderer / scene

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6f8aa6);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.3, 400);
const pitch = THREE.MathUtils.degToRad(params.has('pitch') ? parseFloat(params.get('pitch')!) : 53);
camera.position.set(target.x, target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch));
camera.lookAt(target);

const sun = new THREE.DirectionalLight(0xffd2a0, 2.7);
sun.position.set(target.x - 16, 17, target.z + 9);
sun.target.position.copy(target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 80;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xb8cdf0, 0x4a3e2a, 0.95));

// ground
{
  const size = 90;
  const seg = 270;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + target.x;
    const z = pos.getZ(i) + target.z;
    pos.setX(i, x);
    pos.setZ(i, z);
    pos.setY(i, terrainH(x, z));
    const n = 0.5 + 0.5 * Math.sin(x * 0.45 + Math.sin(z * 0.37) * 1.5) * Math.cos(z * 0.41 - x * 0.17);
    const n2 = 0.5 + 0.5 * Math.sin(x * 2.1 + z * 1.3) * Math.sin(z * 1.7 - x * 0.6);
    c.setRGB(0.19 + 0.07 * n + 0.02 * n2, 0.29 + 0.08 * n + 0.02 * n2, 0.11 + 0.03 * n, THREE.SRGBColorSpace);
    // a dirt road
    const road = 1 - Math.min(1, Math.max(0, (Math.abs(z - 3.2 - Math.sin(x * 0.2) * 0.8) - 0.6) / 0.5));
    c.lerp(new THREE.Color().setRGB(0.42, 0.36, 0.26, THREE.SRGBColorSpace), road);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  scene.add(m);
}

const boxMats = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.8 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8a3026, roughness: 0.7 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f4f86, roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.5 }),
};

function box(x: number, z: number, w: number, h: number, d: number, mat: THREE.Material, y0 = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, getHeight(x, z) + y0 + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function building(x: number, z: number, w: number, h: number, d: number): void {
  box(x, z, w, h, d, boxMats.concrete);
  box(x, z, w * 0.9, 0.12, d * 0.9, boxMats.roof, h);
}
function tank(x: number, z: number, side: 'red' | 'blue', rot = 0): THREE.Group {
  const g = new THREE.Group();
  const mat = side === 'red' ? boxMats.red : boxMats.blue;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.5), mat);
  hull.position.y = 0.16;
  const tur = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.3), mat);
  tur.position.y = 0.33;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), boxMats.metal);
  gun.position.set(0.3, 0.34, 0);
  for (const m of [hull, tur, gun]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.position.set(x, getHeight(x, z), z);
  g.rotation.y = rot;
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Effects

const fx = new Effects({ scene, camera, renderer, getHeight, waterLevel: WATERY ? WATER_LEVEL : -100 });
fx.setSunDirection(sun.position.clone().sub(target));
{
  // debug toggles: hide=main,glow,beams,sprites,decals  nolight=1
  const priv = fx as unknown as Record<string, { mesh: THREE.Object3D }>;
  for (const k of (params.get('hide') ?? '').split(',')) if (priv[k]?.mesh) priv[k].mesh.visible = false;
  if (params.get('nolight') === '1') fx.setLightIntensityScale(0);
}
fx.setAmbientCenter(target.x, target.z);

// composer
const size = new THREE.Vector2(innerWidth, innerHeight);
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(size.clone(), 0.7, 0.45, 0.9));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------------------------
// Scenario helpers

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const G = (x: number, z: number, lift = 0) => V(x, getHeight(x, z) + lift, z);

function every(t0: number, t1: number, period: number, offset = 0): boolean {
  if (t1 < offset) return false;
  return Math.floor((t1 - offset) / period) > Math.floor((t0 - offset) / period) || (t0 < offset && t1 >= offset);
}

interface Shot {
  h: ProjectileHandle;
  a: THREE.Vector3;
  b: THREE.Vector3;
  arc: number;
  t: number;
  dur: number;
  impact: ExplosionKind;
  scale: number;
  wobble: number;
}
const shots: Shot[] = [];
const tmpP = new THREE.Vector3();
const tmpD = new THREE.Vector3();

function fire(kind: ProjectileKind, a: THREE.Vector3, b: THREE.Vector3, speed: number, arc: number, impact: ExplosionKind, scale = 1, wobble = 0): void {
  const h = fx.spawnProjectile(kind);
  const dur = a.distanceTo(b) / speed;
  shots.push({ h, a: a.clone(), b: b.clone(), arc, t: 0, dur, impact, scale, wobble });
  tmpD.subVectors(b, a).normalize();
  if (kind !== 'fireball') fx.muzzleFlash(a, tmpD, kind === 'scud' ? 2.2 : kind === 'cannon' ? 1.2 : 0.9);
}

function shotPos(s: Shot, t: number, out: THREE.Vector3): THREE.Vector3 {
  const f = Math.min(1, t / s.dur);
  out.lerpVectors(s.a, s.b, f);
  out.y += s.arc * 4 * f * (1 - f);
  if (s.wobble) {
    const w = Math.sin(f * Math.PI) * s.wobble;
    out.x += Math.sin(t * 9) * w * 0.15;
    out.z += Math.cos(t * 7) * w * 0.15;
  }
  return out;
}

function stepShots(dt: number): void {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.t += dt;
    shotPos(s, s.t, tmpP);
    shotPos(s, s.t + 0.01, tmpD).sub(tmpP).normalize();
    s.h.update(tmpP, tmpD);
    if (s.t >= s.dur) {
      s.h.end();
      fx.explosion(s.b, s.impact, s.scale);
      shots.splice(i, 1);
    }
  }
}

type Scenario = (t0: number, t1: number) => void;

function explosionsRow(ox: number, oz: number): Scenario {
  const kinds: ExplosionKind[] = ['piff', 'small', 'medium', 'large', 'huge', 'fire', 'electric'];
  return (t0, t1) => {
    if (every(t0, t1, 5, 0.1)) {
      kinds.forEach((k, i) => {
        const x = ox - 10.5 + i * 3.5;
        const z = oz;
        if (k === 'piff') {
          for (let j = 0; j < 4; j++) fx.explosion(G(x + sspread(0.5), z + sspread(0.5), 0.05), 'piff');
        } else fx.explosion(G(x, z, k === 'huge' ? 0.1 : 0.15), k);
      });
    }
    if (every(t0, t1, 5, 2.6)) {
      for (let j = 0; j < 4; j++) fx.explosion(G(ox - 10.5 + sspread(0.5), oz + sspread(0.5), 0.05), 'piff');
    }
  };
}

function singleExplosion(kind: ExplosionKind): Scenario {
  const period: Partial<Record<ExplosionKind, number>> = { piff: 0.6, small: 1.6, medium: 2.5, large: 3.2, huge: 5, fire: 2.2, electric: 1.6, building: 6.5, nuke: 16 };
  const bld = kind === 'building' ? box(0, 0, 2.2, 1.0, 2.2, boxMats.concrete) : null;
  return (t0, t1) => {
    // the structure model disappears when the final blast goes off (period 6.5s, blast at +1.3s)
    if (bld) bld.visible = ((t1 - 0.1) % 6.5) < 1.3 || t1 < 0.1;
    if (every(t0, t1, period[kind] ?? 3, 0.1)) {
      if (kind === 'piff') {
        for (let j = 0; j < 5; j++) fx.explosion(G(sspread(0.6), sspread(0.6), 0.05), 'piff');
      } else if (kind === 'building') fx.explosion(G(0, 0, 0.5), 'building', 2.2);
      else fx.explosion(G(0, 0, kind === 'nuke' ? 0 : 0.15), kind);
    }
  };
}

function projectiles(ox: number, oz: number, compact = false): Scenario {
  const rows: { kind: ProjectileKind; speed: number; arc: number; impact: ExplosionKind; period: number; scale?: number; wobble?: number }[] = [
    { kind: 'cannon', speed: 14, arc: 0.15, impact: 'small', period: 0.9 },
    { kind: 'ballistic', speed: 6.5, arc: 3.2, impact: 'medium', period: 2.2 },
    { kind: 'lobbed', speed: 5, arc: 1.3, impact: 'medium', period: 1.6, scale: 0.7 },
    { kind: 'missile', speed: 7.5, arc: 0.8, impact: 'small', period: 1.3, scale: 1.2, wobble: 1 },
    { kind: 'scud', speed: 6, arc: 6.5, impact: 'huge', period: 4.5 },
    { kind: 'fireball', speed: 8, arc: 0.4, impact: 'fire', period: 1.5 },
  ];
  const span = compact ? 6 : 8;
  rows.forEach((_r, i) => {
    const z = oz - 6 + i * 2.4 * (compact ? 0.8 : 1);
    tank(ox - span - 0.6, z, 'blue');
  });
  return (t0, t1) => {
    rows.forEach((r, i) => {
      const z = oz - 6 + i * 2.4 * (compact ? 0.8 : 1);
      if (every(t0, t1, r.period, 0.05 + i * 0.17)) {
        const a = G(ox - span, z, 0.35);
        const b = G(ox + span * 0.9 + sspread(0.8), z + sspread(0.5), 0.05);
        fire(r.kind, a, b, r.speed, r.arc, r.impact, r.scale ?? 1, r.wobble ?? 0);
      }
    });
  };
}

function beams(ox: number, oz: number): Scenario {
  tank(ox - 6.4, oz - 3, 'red');
  // tesla coil
  box(ox - 5, oz + 1.2, 0.5, 1.8, 0.5, boxMats.metal);
  const coilTip = G(ox - 5, oz + 1.2, 2.05);
  const flamer = G(ox - 3.5, oz + 4.6, 0.2);
  return (t0, t1) => {
    // machine-gun bursts
    for (let k = 0; k < 6; k++) {
      if (every(t0, t1, 1.4, 0.05 + k * 0.08)) {
        const a = G(ox - 6, oz - 3, 0.36);
        const b = G(ox + 4 + sspread(0.5), oz - 3 + sspread(0.5), 0.05);
        fx.tracer(a, b);
        fx.muzzleFlash(a, tmpD.subVectors(b, a).normalize(), 0.6);
        fx.explosion(b, 'piff');
      }
    }
    if (every(t0, t1, 1.8, 0.3)) {
      const b = G(ox + 3 + sspread(0.6), oz + 1.2 + sspread(0.6), 0.25);
      fx.teslaBolt(coilTip, b);
      fx.explosion(b, 'electric');
    }
    if (every(t0, t1, 1.5, 0.6)) {
      const b = G(ox + 0.2 + sspread(0.3), oz + 4.6 + sspread(0.3), 0.05);
      fx.flameStream(flamer, b);
      fx.explosion(b, 'fire', 0.8);
    }
  };
}

const emitterHandles: EmitterHandle[] = [];
function emitters(ox: number, oz: number): Scenario {
  building(ox - 6, oz - 1, 2, 1.1, 2);
  building(ox - 2, oz - 1, 1.6, 0.9, 1.6);
  building(ox + 2.5, oz - 1, 2.2, 1.4, 1.6);
  box(ox + 2.0, oz - 1.3, 0.25, 1.1, 0.25, boxMats.metal, 1.4);
  box(ox + 2.8, oz - 1.3, 0.25, 0.9, 0.25, boxMats.metal, 1.4);
  building(ox + 6.5, oz - 1, 1.8, 1.0, 1.8);
  box(ox - 3.5, oz + 3, 1.2, 0.5, 1.2, boxMats.concrete);
  const mover = tank(ox - 4, oz + 5, 'red');
  emitterHandles.push(fx.createEmitter('fire', G(ox - 6.3, oz - 0.8, 1.2)));
  emitterHandles.push(fx.createEmitter('smoke', G(ox - 5.6, oz - 1.3, 1.25)));
  const sm = fx.createEmitter('smoke', G(ox - 2, oz - 1, 1.0));
  sm.setIntensity(1.6);
  emitterHandles.push(sm);
  emitterHandles.push(fx.createEmitter('chimney', G(ox + 2.0, oz - 1.3, 2.55)));
  emitterHandles.push(fx.createEmitter('chimney', G(ox + 2.8, oz - 1.3, 2.35)));
  emitterHandles.push(fx.createEmitter('sparks', G(ox + 6.0, oz - 0.2, 0.8)));
  emitterHandles.push(fx.createEmitter('fire', G(ox + 6.9, oz - 1.2, 1.05)));
  emitterHandles.push(fx.createEmitter('steam', G(ox - 3.5, oz + 3, 0.55)));
  const ex = fx.createEmitter('exhaust', G(ox - 4, oz + 5, 0.35));
  emitterHandles.push(ex);
  const p = new THREE.Vector3();
  return (_t0, t1) => {
    const x = ox - 4 + ((t1 * 1.2) % 10);
    const z = oz + 5;
    mover.position.set(x, getHeight(x, z), z);
    ex.setPosition(p.set(x - 0.35, getHeight(x, z) + 0.35, z + 0.1));
    if (every(t1 - 1 / 60, t1, 0.07)) fx.dust(p.set(x - 0.45, 0, z), 1);
  };
}

function decals(ox: number, oz: number): Scenario {
  return (t0, t1) => {
    if (every(t0, t1, 0.35, 0.05)) fx.scorch(G(ox + sspread(9), oz + sspread(5)), 0.6 + srnd() * 1.6);
    if (every(t0, t1, 0.3, 0.1)) fx.bloodSplat(G(ox + sspread(9), oz + sspread(5)));
  };
}

function misc(ox: number, oz: number): Scenario {
  const mover = tank(ox - 9, oz + 4.5, 'blue');
  box(ox + 6, oz - 4, 1.2, 0.6, 1.2, boxMats.blue);
  return (t0, t1) => {
    if (every(t0, t1, 1.2, 0.05)) fx.orderMarker(G(ox - 8, oz - 3.5), 'move');
    if (every(t0, t1, 1.2, 0.25)) fx.orderMarker(G(ox - 5.5, oz - 3.5), 'attack');
    if (every(t0, t1, 1.2, 0.45)) fx.orderMarker(G(ox - 3, oz - 3.5), 'rally');
    if (every(t0, t1, 1.4, 0.1)) fx.healPulse(G(ox - 8, oz + 0.5, 0.2));
    if (every(t0, t1, 0.45, 0.1)) fx.oreSparkle(G(ox - 5 + sspread(0.6), oz + 0.5 + sspread(0.6), 0.05), false);
    if (every(t0, t1, 0.45, 0.3)) fx.oreSparkle(G(ox - 3 + sspread(0.6), oz + 0.5 + sspread(0.6), 0.05), true);
    if (every(t0, t1, 3, 0.2)) fx.constructionBurst(G(ox + 1.5, oz - 2.5), 2);
    if (every(t0, t1, 3, 0.4)) fx.chronoFlash(G(ox + 1.5, oz + 2.5));
    if (every(t0, t1, 3, 0.3)) fx.ironCurtainPulse(G(ox + 6, oz - 4, 0.3), 1.3);
    const x = ox - 9 + ((t1 * 1.5) % 16);
    mover.position.set(x, getHeight(x, oz + 4.5), oz + 4.5);
    if (every(t1 - 1 / 60, t1, 0.06)) fx.dust(G(x - 0.45, oz + 4.5), 1.2);
  };
}

// ---------------------------------------------------------------------------------------------
// Round-4 scenarios: naval combat, support powers, bridges (map space around OX, OZ)

interface Actor {
  m: ModelInstance;
  s: ModelAnimState;
  drive: (t: number, dt: number, a: Actor) => void;
  x: number;
  z: number;
  heading: number;
  speed: number;
}
const actors: Actor[] = [];
let water: Water | null = null;
let wakes: ShipWakes | null = null;
let gapField: GapField | null = null;
const gapSources: GapSource[] = [];
const bridgeRenderers: { r: BridgeRenderer; list: BridgeState[] }[] = [];
const wakeShips: WakeShip[] = [];
const ALLIED = new THREE.Color(0x3d7be0);
const SOVIET = new THREE.Color(0xd23a2c);

function animState(): ModelAnimState {
  return {
    time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1,
    door: 0, load: 0, harvesting: false, charge: 1, dying: 0, altitude: 0,
    submerged: 0, parachute: 0, deployed: 0, cloak: 0,
  };
}

function actor(id: string, color: THREE.Color, x: number, z: number, drive: Actor['drive'] = () => {}): Actor {
  const m = createModel(id, color);
  m.root.position.set(x, getHeight(x, z), z);
  scene.add(m.root);
  const a: Actor = { m, s: animState(), drive, x, z, heading: 0, speed: 0 };
  actors.push(a);
  return a;
}

function place(a: Actor, x: number, y: number, z: number, heading: number): void {
  a.x = x;
  a.z = z;
  a.heading = heading;
  a.m.root.position.set(x, y, z);
  a.m.root.rotation.y = -heading;
}

function addWater(): void {
  const map = new GameMap(64, 64);
  for (let j = 0; j <= 64; j++) for (let i = 0; i <= 64; i++) map.heights[j * 65 + i] = terrainH(i, j);
  const sd = sun.position.clone().sub(target).normalize();
  water = new Water(map, (x, y) => map.heightAt(x, y), sd, false);
  water.sun = sun;
  const pr = renderer.getPixelRatio();
  water.setSize(innerWidth * pr, innerHeight * pr);
  water.setLighting(sd, sun.color, sun.intensity, new THREE.Color(0x8fb0d0), (scene.background as THREE.Color) ?? new THREE.Color(0x6f8aa6), 0);
  scene.add(water.mesh);
}

function muzzlePos(a: Actor, i: number, out: THREE.Vector3): THREE.Vector3 {
  a.m.root.updateMatrixWorld(true);
  const mz = a.m.muzzles[i % Math.max(1, a.m.muzzles.length)];
  if (mz) mz.getWorldPosition(out);
  else out.copy(a.m.root.position);
  return out;
}

interface NShot {
  h: ProjectileHandle;
  a: THREE.Vector3;
  b: THREE.Vector3;
  arc: number;
  t: number;
  dur: number;
  impact: () => void;
}
const nshots: NShot[] = [];
function nfire(kind: ProjectileKind, a: THREE.Vector3, b: THREE.Vector3, speed: number, arc: number, impact: () => void, size = 1): void {
  const h = fx.spawnProjectile(kind, size);
  nshots.push({ h, a: a.clone(), b: b.clone(), arc, t: 0, dur: Math.max(0.2, a.distanceTo(b) / speed), impact });
}
function stepNShots(dt: number): void {
  for (let i = nshots.length - 1; i >= 0; i--) {
    const s = nshots[i];
    s.t += dt;
    const pos = (t: number, out: THREE.Vector3) => {
      const f = Math.min(1, t / s.dur);
      out.lerpVectors(s.a, s.b, f);
      out.y += s.arc * 4 * f * (1 - f);
      return out;
    };
    pos(s.t, tmpP);
    pos(s.t + 0.01, tmpD).sub(tmpP);
    if (tmpD.lengthSq() < 1e-9) tmpD.set(1, 0, 0);
    tmpD.normalize();
    s.h.update(tmpP, tmpD);
    if (s.t >= s.dur) {
      s.h.end();
      s.impact();
      nshots.splice(i, 1);
    }
  }
}

/** Point on a circle path + tangent heading. */
function circ(cx: number, cz: number, r: number, w: number, t: number, ph: number): [number, number, number] {
  const th = ph + w * t;
  return [cx + Math.cos(th) * r, cz + Math.sin(th) * r, th + (w >= 0 ? Math.PI / 2 : -Math.PI / 2)];
}

function naval(): Scenario {
  addWater();
  wakes = new ShipWakes({ waterLevel: WATER_LEVEL, effects: fx });
  scene.add(wakes.mesh);
  const WL = WATER_LEVEL;
  const ships: Actor[] = [];
  const ca = actor('ca', ALLIED, OX, OZ, (t, _dt, a) => {
    const [x, z, h] = circ(OX + 0.5, OZ + 0.8, 5.6, 0.15, t, 2.2);
    place(a, x, WL, z, h);
    a.s.moving = true;
    a.s.speed = a.speed = 0.7;
  });
  const dd = actor('dd', ALLIED, OX, OZ, (t, _dt, a) => {
    const [x, z, h] = circ(OX - 1.5, OZ + 0.2, 3.3, -0.32, t, 0.5);
    place(a, x, WL, z, h);
    a.s.moving = true;
    a.s.speed = a.speed = 0.9;
  });
  const pt = actor('pt', ALLIED, OX, OZ, (t, _dt, a) => {
    const [x, z, h] = circ(OX + 7.2, OZ - 0.8, 2.0, 0.62, t, 1);
    place(a, x, WL, z, h);
    a.s.moving = true;
    a.s.speed = a.speed = 1;
  });
  const ss = actor('ss', SOVIET, OX, OZ, (t, _dt, a) => {
    const k = Math.sin(t * 0.22);
    const x = OX - 3 + k * 5;
    const z = OZ + 4.6 + Math.sin(t * 0.5) * 0.3;
    const h = Math.cos(t * 0.22) >= 0 ? 0 : Math.PI;
    place(a, x, WL, z, h);
    a.s.moving = true;
    a.s.speed = a.speed = 0.6;
    a.s.submerged = (t % 16) > 8 ? 1 : 0;
  });
  const lst = actor('lst', ALLIED, OX, OZ, (t, _dt, a) => {
    place(a, OX - 10.4, WL, OZ - 1.5, Math.PI + 0.15);
    a.s.deployed = (t % 10) > 4 ? 1 : 0;
    a.speed = 0;
  });
  const spen = actor('spen', SOVIET, OX + 2.5, OZ - 5.2, (t, _dt, a) => {
    a.m.root.position.set(OX + 2.5, WL, OZ - 5.2);
    a.s.door = (t % 12) > 9 ? 1 : 0;
  });
  void spen;
  ships.push(ca, dd, pt, ss, lst);
  for (let i = 0; i < ships.length; i++) wakeShips.push({ x: 0, y: 0, heading: 0, speed: 0, size: 1, id: i });
  const sizes = [2.35, 1.5, 0.9, 1.3, 1.4];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  return (t0, t1) => {
    for (let i = 0; i < ships.length; i++) {
      const w = wakeShips[i];
      const a = ships[i];
      w.x = a.x;
      w.y = a.z;
      w.heading = a.heading;
      w.speed = a.speed;
      w.size = i === 3 ? sizes[i] * (1 - 0.5 * (a.s.submerged ?? 0)) : sizes[i];
    }
    // cruiser: 8-inch salvo into the lake (alternating fore / aft turret)
    if (every(t0, t1, 2.6, 0.4)) {
      const m = Math.floor(t1 / 2.6) % 2;
      ca.s.firing = 1;
      ca.s.firingMuzzle = m;
      muzzlePos(ca, m, p);
      const tx = OX - 4 + sspread(5), tz = OZ + 2 + sspread(3);
      q.set(tx, WL, tz);
      fx.muzzleFlash(p, tmpD.subVectors(q, p).normalize(), 2.2);
      nfire('ballistic', p, q, 8, 1.8, () => fx.explosion(q.clone(), 'medium', 1.2), 1.8);
    }
    // gunboat: quick cannon shots splashing short
    if (every(t0, t1, 1.7, 0.9)) {
      pt.s.firing = 1;
      muzzlePos(pt, 0, p);
      q.set(OX + 9 + sspread(1.5), WL, OZ + 2.5 + sspread(1));
      fx.muzzleFlash(p, tmpD.subVectors(q, p).normalize(), 1);
      const dest = q.clone();
      nfire('cannon', p, q, 12, 0.15, () => fx.explosion(dest, 'small'));
    }
    // submarine: torpedo at the destroyer
    if (every(t0, t1, 3.4, 1.2)) {
      muzzlePos(ss, 0, p);
      p.y = WL - 0.06;
      q.set(dd.x, WL - 0.06, dd.z);
      const dest = q.clone();
      nfire('torpedo', p, q, 4, 0, () => fx.explosion(dest, 'medium'));
    }
    // destroyer: depth charges over the side (land under water -> underwater blasts)
    if (every(t0, t1, 4.2, 2.0)) {
      for (const m of [2, 3]) {
        dd.s.firing = 1;
        muzzlePos(dd, m, p);
        const side = m === 2 ? 1 : -1;
        q.set(p.x - Math.sin(dd.heading) * 1.1 * side, WL - 0.25, p.z + Math.cos(dd.heading) * 1.1 * side);
        const dest = q.clone();
        nfire('depthcharge', p, q, 2.2, 0.55, () => fx.explosion(dest, 'small'));
      }
    }
    // bullets kicking up water near the transport
    if (every(t0, t1, 2.2, 0.3)) for (let i = 0; i < 4; i++) fx.waterSplash(V(OX - 8.5 + sspread(0.8), WL, OZ - 0.5 + sspread(0.8)), 0.3);
    // sonar from the pen
    if (every(t0, t1, 6.5, 0.8)) fx.sonarPing(V(OX + 2.5, WL, OZ - 3.6), 5);
  };
}

function powers(): Scenario {
  addWater();
  gapField = new GapField({ getHeight });
  scene.add(gapField.mesh);
  const atek = actor('atek', ALLIED, OX - 6, OZ - 3);
  const gap = actor('gap', ALLIED, OX + 2.5, OZ - 3.5);
  const mgg = actor('mgg', ALLIED, OX + 7, OZ + 1, (_t, _dt, a) => {
    a.s.deployed = 1;
  });
  const mrj = actor('mrj', ALLIED, OX - 2, OZ + 3.5, (_t, _dt, a) => {
    a.s.deployed = 1;
  });
  mgg.m.root.rotation.y = 0.6;
  mrj.m.root.rotation.y = -0.4;
  actor('hbox', ALLIED, OX - 9.5, OZ + 2.5, (_t, _dt, a) => {
    a.s.cloak = 1;
  });
  const mines = [actor('minv', ALLIED, OX - 7.5, OZ + 5.8), actor('minp', SOVIET, OX - 5.8, OZ + 5.8), actor('minv', SOVIET, OX - 4.2, OZ + 5.8)];
  const mineless: number[] = [0, 0, 0];
  gapSources.push({ x: OX + 2.5, y: OZ - 3.5, radius: 3.6 }, { x: OX + 7, y: OZ + 1, radius: 2.4 });
  void atek;
  void gap;
  // badger bombing run with contrails
  const badr = actor('badr', SOVIET, OX - 20, OZ + 0.5, (t, _dt, a) => {
    const cyc = t % 12;
    const x = OX - 22 + cyc * 4;
    place(a, x, getHeight(x, OZ + 0.5) + 3.4, OZ + 0.5, 0);
    a.m.root.position.y = 3.4;
    a.s.altitude = 3.4;
    a.s.moving = true;
    a.s.deployed = x > OX - 6 && x < OX + 6 ? 1 : 0;
  });
  const u2 = actor('u2', ALLIED, OX, OZ, (t, _dt, a) => {
    const cyc = (t + 5) % 14;
    const x = OX + 22 - cyc * 3.4;
    place(a, x, 4.6, OZ - 6 + cyc * 0.9, Math.PI - 0.26);
    a.s.altitude = 4.6;
    a.s.moving = true;
  });
  let trails: ProjectileHandle[] = [];
  let u2trail: ProjectileHandle | null = null;
  // paratroopers
  const paras = [0, 1, 2, 3].map((i) =>
    actor(i === 3 ? 'spy' : 'e1', SOVIET, OX + 1 + i * 0.7, OZ + 5.5, (t, dt, a) => {
      const cyc = (t + i * 0.6) % 10;
      const fall = 5;
      const gy = getHeight(a.x, a.z);
      const alt = Math.max(0, 4 * (1 - cyc / fall));
      a.m.root.position.y = gy + alt;
      const target = cyc < fall ? 1 : 0;
      a.s.parachute = (a.s.parachute ?? 0) + (target - (a.s.parachute ?? 0)) * Math.min(1, dt * (target ? 8 : 1.2));
      a.s.moving = false;
    }),
  );
  paras.forEach((a, i) => place(a, OX + 1 + i * 0.7, 0, OZ + 5.4 + (i % 2) * 0.5, 1.2));
  const tran = actor('tran', ALLIED, OX + 9, OZ - 3, (_t, _dt, a) => {
    a.m.root.position.y = getHeight(OX + 9, OZ - 3) + 0.9;
    a.s.altitude = 0.9;
    a.s.deployed = 1;
    a.s.moving = true;
  });
  tran.m.root.rotation.y = 2.4;
  const bombs: { h: ProjectileHandle; p: THREE.Vector3; v: THREE.Vector3 }[] = [];
  const sp = new THREE.Vector3();
  return (t0, t1) => {
    const dt = t1 - t0;
    // gps launch from the tech centre roof
    if (every(t0, t1, 11, 0.5)) fx.gpsLaunch(G(OX - 6.3, OZ - 3.2, 0.95));
    if (every(t0, t1, 2.4, 0.2)) fx.radarJamPulse(G(mrj.x, mrj.z), 3.2);
    if (every(t0, t1, 7, 1.0)) fx.sonarPing(V(OX + 12, WATER_LEVEL, OZ + 7), 3);
    // mines go off one after another and re-arm
    for (let i = 0; i < 3; i++) {
      if (every(t0, t1, 7.5, 1.5 + i * 2.2)) {
        const m = mines[i];
        fx.mineBlast(G(m.x, m.z), i === 1 ? 'ap' : 'at');
        m.m.root.visible = false;
        mineless[i] = 3;
      }
      if (mineless[i] > 0) {
        mineless[i] -= dt;
        if (mineless[i] <= 0) mines[i].m.root.visible = true;
      }
    }
    // contrails follow the engine smoke points
    const cyc = t1 % 12;
    if (cyc < t0 % 12 || trails.length === 0) {
      for (const tr of trails) tr.end();
      trails = (badr.m.smokePoints ?? []).map(() => fx.spawnTrail('contrail', 1));
    }
    badr.m.root.updateMatrixWorld(true);
    (badr.m.smokePoints ?? []).forEach((o, i) => trails[i]?.update(o.getWorldPosition(sp), tmpD.set(1, 0, 0)));
    if (!u2trail || (t1 + 5) % 14 < (t0 + 5) % 14) {
      u2trail?.end();
      u2trail = fx.spawnTrail('contrail', 0.8);
    }
    u2.m.root.updateMatrixWorld(true);
    const ex = u2.m.smokePoints?.[0];
    if (ex) u2trail.update(ex.getWorldPosition(sp), tmpD.set(-1, 0, 0));
    // bombs out of the bay
    if (badr.s.deployed && every(t0, t1, 0.42, 0.1)) {
      badr.m.root.updateMatrixWorld(true);
      const m0 = badr.m.muzzles[0];
      m0.getWorldPosition(sp);
      bombs.push({ h: fx.spawnProjectile('bomb'), p: sp.clone(), v: new THREE.Vector3(4, -0.3, 0) });
    }
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.v.y -= 9 * dt;
      b.v.x *= 1 - 0.25 * dt;
      b.p.addScaledVector(b.v, dt);
      b.h.update(b.p, tmpD.copy(b.v).normalize());
      const gy = getHeight(b.p.x, b.p.z);
      if (b.p.y <= gy) {
        b.h.end();
        fx.explosion(V(b.p.x, gy, b.p.z), 'medium', 1.1);
        bombs.splice(i, 1);
      }
    }
  };
}

function riverCells(cx0: number, axis: 'x' | 'y', across: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let k = 0; k < 64; k++) {
    const cx = axis === 'y' ? across : k;
    const cy = axis === 'y' ? k : across;
    if (waterMask(cx + 0.5, cy + 0.5) > 0.5) cells.push([cx, cy]);
  }
  void cx0;
  return cells;
}

function bridges(): Scenario {
  addWater();
  const climates: BridgeClimate[] = ['temperate', 'desert', 'winter'];
  const cols = [OX - 7, OX - 1, OX + 5];
  climates.forEach((c, i) => {
    const r = new BridgeRenderer({ heightAt: (x, y) => terrainH(x, y), climate: c, effects: fx });
    scene.add(r.group);
    const list: BridgeState[] = [{ id: i + 1, cells: riverCells(0, 'y', cols[i]), axis: 'y', hp: 1000, maxHp: 1000, alive: true }];
    if (i === 0) list.push({ id: 9, cells: riverCells(0, 'x', OZ + 4), axis: 'x', hp: 1000, maxHp: 1000, alive: true });
    bridgeRenderers.push({ r, list });
  });
  // a tank driving back and forth over the temperate bridge (uses deckHeightAt)
  const br = bridgeRenderers[0].r;
  actor('2tnk', ALLIED, cols[0] + 0.5, OZ, (t, _dt, a) => {
    const z = OZ - 0.5 + Math.sin(t * 0.35) * 4.2;
    const x = cols[0] + 0.5;
    const y = br.deckHeightAt(x, z) ?? getHeight(x, z);
    place(a, x, y, z, Math.cos(t * 0.35) >= 0 ? Math.PI / 2 : -Math.PI / 2);
    a.s.moving = true;
    a.s.speed = 0.8;
  });
  actor('3tnk', SOVIET, OX + 12.5, OZ + 4.5, (t, _dt, a) => {
    const x = OX + 12.5 + Math.sin(t * 0.3) * 4;
    const z = OZ + 4.5;
    const y = bridgeRenderers[0].r.deckHeightAt(x, z) ?? getHeight(x, z);
    place(a, x, y, z, Math.cos(t * 0.3) >= 0 ? 0 : Math.PI);
    a.s.moving = true;
    a.s.speed = 0.8;
  });
  return (_t0, t1) => {
    // desert bridge: worn down, collapses, rebuilt (14 s cycle); winter bridge: badly damaged
    const des = bridgeRenderers[1].list[0];
    const cyc = t1 % 14;
    if (cyc < 6) {
      des.alive = true;
      des.hp = des.maxHp * (1 - cyc / 6);
    } else if (cyc < 11) {
      des.alive = false;
      des.hp = 0;
    } else {
      des.alive = true;
      des.hp = des.maxHp;
    }
    bridgeRenderers[2].list[0].hp = 380;
  };
}

let scenarios: Scenario[] = [];
if (only === 'atlas') {
  // show the generated textures on planes (rgb | alpha | decals | ramp)
  const tx = fx.textures;
  const mk = (tex: THREE.Texture, x: number, w: number, h: number, alphaOnly = false) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, a: { value: alphaOnly ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float a; varying vec2 vUv; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(a > 0.5 ? vec3(t.a) : t.rgb * (0.25 + 0.75 * t.a), 1.0); }',
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 2, 0);
    scene.add(m);
  };
  mk(tx.atlas, -9, 8, 8);
  mk(tx.atlas, -0.5, 8, 8, true);
  mk(tx.decals, 8, 8, 8);
  mk(tx.ramp, 0, 24, 3);
  (scene.children.at(-1) as THREE.Object3D).position.set(0, 2.1, 6.5);
}
switch (only) {
  case 'atlas': break;
  case 'all': {
    scenarios = [explosionsRow(0, -8), projectiles(0, 3, true), emitters(14, -4), misc(-12, 9)];
    building(-12, -3, 2, 1.2, 2);
    break;
  }
  case 'explosions': scenarios = [explosionsRow(0, 0)]; break;
  case 'projectiles': scenarios = [projectiles(0, 0)]; break;
  case 'beams': case 'tracer': case 'tesla': case 'flame': scenarios = [beams(0, -1)]; break;
  case 'emitters': scenarios = [emitters(0, 0)]; break;
  case 'decals': scenarios = [decals(0, 0)]; break;
  case 'misc': case 'markers': scenarios = [misc(0, 0)]; break;
  case 'naval': scenarios = [naval()]; break;
  case 'powers': scenarios = [powers()]; break;
  case 'bridges': scenarios = [bridges()]; break;
  default:
    if (EXPLOSION_KINDS.includes(only as ExplosionKind)) scenarios = [singleExplosion(only as ExplosionKind)];
    else scenarios = [explosionsRow(0, 0)];
}
if (only !== 'all' && only !== 'emitters' && !WATERY) {
  // a few props for scale
  tank(4.5, 3.5, 'blue', 0.4);
  tank(-6, 4.8, 'red', 2.6);
  building(8, -5, 2, 1.1, 2);
}

// ---------------------------------------------------------------------------------------------
// Simulation loop

const STEP = 1 / 60;
let simTime = 0;
function step(): void {
  const t0 = simTime;
  const t1 = simTime + STEP;
  for (const s of scenarios) s(t0, t1);
  stepShots(STEP);
  stepNShots(STEP);
  for (const a of actors) {
    a.drive(t1, STEP, a);
    a.s.time = t1;
    a.s.dt = STEP;
    a.s.firing = Math.max(0, a.s.firing - STEP * 4);
    a.m.update(a.s);
  }
  water?.update(t1);
  wakes?.update(wakeShips, STEP);
  gapField?.update(gapSources, t1);
  for (const b of bridgeRenderers) b.r.update(b.list, STEP, t1);
  fx.update(STEP, t1);
  simTime = t1;
}

const hud = document.getElementById('hud')!;
let hudTimer = 0;
function updateHud(): void {
  if (!showHud) return;
  const st = fx.stats();
  hud.textContent = `only=${only}  t=${simTime.toFixed(2)}s  main=${st.mainAlive}  glow=${st.glowAlive}  emitters=${st.emitters}  shake=${fx.shake.toFixed(2)}  draw calls (scene+post)=${renderer.info.render.calls}`;
}

renderer.info.autoReset = false;
function render(): void {
  renderer.info.reset();
  composer.render();
}

function runBench(): void {
  const results: string[] = [];
  const t = () => performance.now();
  // 50 explosions in one go
  const kinds: ExplosionKind[] = ['small', 'medium', 'large', 'medium', 'small', 'electric', 'fire', 'huge'];
  let a = t();
  for (let i = 0; i < 50; i++) fx.explosion(G(sspread(12), sspread(8), 0.15), kinds[i % kinds.length]);
  const spawn50 = t() - a;
  // 100 projectiles in flight
  const pk: ProjectileKind[] = ['missile', 'cannon', 'ballistic', 'scud', 'fireball', 'lobbed'];
  const benchShots: Shot[] = [];
  const mk = (i: number): Shot => {
    const s: Shot = { h: fx.spawnProjectile(pk[i % pk.length]), a: G(-12, sspread(8), 0.4), b: G(12, sspread(8), 0), arc: 2, t: srnd() * 2, dur: 3 + srnd(), impact: 'small', scale: 1, wobble: 0 };
    return s;
  };
  for (let i = 0; i < 100; i++) benchShots.push(mk(i));
  // 30 emitters
  const ek = ['smoke', 'fire', 'chimney', 'sparks', 'steam', 'exhaust'] as const;
  for (let i = 0; i < 30; i++) fx.createEmitter(ek[i % ek.length], G(sspread(12), sspread(8), 1));
  const frames = 600;
  let upd = 0, hnd = 0, spn = 0, maxFrame = 0, worstIdx = -1;
  for (let f = 0; f < frames; f++) {
    const f0 = t();
    // keep ~30 explosions / s going (every other frame)
    if (f % 2 === 0) fx.explosion(G(sspread(12), sspread(8), 0.15), kinds[f % kinds.length]);
    // tracers + bolts
    if (f % 3 === 0) fx.tracer(G(-8, sspread(6), 0.4), G(8, sspread(6), 0));
    if (f % 20 === 0) fx.teslaBolt(G(-6, 0, 2), G(4, sspread(4), 0.3));
    const f1 = t();
    for (let i = 0; i < benchShots.length; i++) {
      const s = benchShots[i];
      s.t += STEP;
      shotPos(s, s.t, tmpP);
      shotPos(s, s.t + 0.01, tmpD).sub(tmpP).normalize();
      s.h.update(tmpP, tmpD);
      if (s.t >= s.dur) {
        s.h.end();
        fx.explosion(s.b, 'small');
        benchShots[i] = mk(i);
      }
    }
    const f2 = t();
    fx.update(STEP, f * STEP);
    const f3 = t();
    spn += f1 - f0;
    hnd += f2 - f1;
    upd += f3 - f2;
    if (f >= 30 && f3 - f0 > maxFrame) { maxFrame = f3 - f0; worstIdx = f; }
    if (f % 60 === 59) render();
  }
  simTime = frames * STEP;
  // warm (JIT-compiled) burst of 50 explosions
  a = t();
  for (let i = 0; i < 50; i++) fx.explosion(G(sspread(12), sspread(8), 0.15), kinds[i % kinds.length]);
  const spawn50warm = t() - a;
  a = t();
  fx.update(STEP, simTime);
  const updAfterBurst = t() - a;
  const st = fx.stats();
  results.push(`50 explosions spawned in ${spawn50.toFixed(2)} ms cold, ${spawn50warm.toFixed(2)} ms warm (update() right after the burst: ${updAfterBurst.toFixed(3)} ms)`);
  results.push(`per frame (avg of ${frames}): update() ${(upd / frames).toFixed(3)} ms, 100 projectile handle updates ${(hnd / frames).toFixed(3)} ms, spawning (~30 expl/s + tracers + bolts) ${(spn / frames).toFixed(3)} ms, total ${((upd + hnd + spn) / frames).toFixed(3)} ms, worst frame after warm-up ${maxFrame.toFixed(2)} ms (#${worstIdx})`);
  results.push(`live particles: main ${st.mainAlive}, glow ${st.glowAlive}; emitters ${st.emitters}`);
  for (const r of results) console.warn('[bench] ' + r);
  hud.textContent = results.join('\n');
}

if (bench) {
  runBench();
  render();
  render();
} else if (tTarget >= 0) {
  while (simTime < tTarget - 1e-6) step();
  render();
  updateHud();
  render();
  if (play) loop();
} else {
  loop();
}

function loop(): void {
  let last = performance.now();
  let acc = 0;
  const frame = () => {
    const nowMs = performance.now();
    acc += Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    while (acc >= STEP) {
      step();
      acc -= STEP;
    }
    hudTimer += 1;
    if (hudTimer % 15 === 0) updateHud();
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// expose for debugging
(window as unknown as { fx: Effects }).fx = fx;
