/**
 * Destruction preview (preview-models.html?destroy=<scene>): structure collapses, vehicle wrecks and
 * debris, infantry ragdolls, damage stages, craters and the Aftermath effects, on a small hilly
 * heightfield with the real effects system.
 *
 * URL params:
 *   destroy=buildings|vehicles|infantry|damage|aftermath|craters|all
 *   ids=powr,weap      structures / vehicles to use (scene dependent defaults)
 *   t=SECONDS          fast-forward at fixed 1/60 s steps and freeze (play=1 keeps running)
 *   loop=SECONDS       restart the scenario every N seconds (default 14, 0 = never)
 *   dist=N pitch=DEG yaw=DEG cx=X cz=Z   camera
 *   q=low              no bloom
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Effects } from './effects';
import { seedRandom } from './effects/rand';
import type { GameMap } from '../sim/map';
import { WATER_LEVEL } from '../sim/map';
import { BUILDINGS, UNITS } from '../data/rules';
import { createModel } from './models';
import type { ModelAnimState, ModelInstance } from './models/types';
import { BodyVariant } from './models/materials';
import { Destruction } from './destruction';
import { Rubble } from './rubble';

const params = new URLSearchParams(location.search);
const scene0 = params.get('destroy') || 'all';
const tTarget = params.has('t') ? parseFloat(params.get('t')!) : -1;
const play = params.get('play') === '1' || tTarget < 0;
const loopT = params.has('loop') ? parseFloat(params.get('loop')!) : 14;
const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
seedRandom(parseInt(params.get('seed') ?? '1', 10));
// physics / ragdolls use Math.random: make screenshots repeatable
{
  let s = parseInt(params.get('seed') ?? '7', 10) || 7;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 16777216;
  };
}

const ALLIED = new THREE.Color(0x3d7be0);
const SOVIET = new THREE.Color(0xd23a2c);

// ---------------------------------------------------------------------------------------------
// Ground: gentle hills with a steep bank (wrecks tumble down it) and a pond

const SIZE = 48;
const RES = 192;
const bumps: { x: number; z: number; r: number; d: number }[] = [];
function baseH(x: number, z: number): number {
  let h = 0.18 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 0.1 * Math.sin(x * 0.07 + z * 0.11);
  // a bank rising toward -z (behind the vehicle row)
  h += Math.max(0, -z - 3) * 0.32;
  // pond at +x +z
  const pd = Math.hypot(x - 13, z - 7);
  if (pd < 4.5) h -= (1 - pd / 4.5) ** 1.5 * 0.9;
  return h;
}
function H(x: number, z: number): number {
  let h = baseH(x, z);
  for (const b of bumps) {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < b.r) h -= b.d * (1 - (d / b.r) ** 2) ** 2;
  }
  return h;
}

const map = {
  w: SIZE,
  h: SIZE,
  climate: 'temperate',
  heightAt: (x: number, y: number) => H(x, y),
  surfaceAt: (x: number, y: number) => Math.max(H(x, y), WATER_LEVEL),
} as unknown as GameMap;

// ---------------------------------------------------------------------------------------------
// Renderer

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ab8d6);
scene.fog = new THREE.Fog(0x9ab8d6, 40, 90);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
scene.add(new THREE.HemisphereLight(0xc4dcff, 0x56683a, 0.8));
const sun = new THREE.DirectionalLight(0xffdcb0, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
const ext = 16;
Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
sun.position.set(-20, 26, 16);
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const target = new THREE.Vector3(num('cx', 0), 0, num('cz', 0));
function placeCamera(dist: number) {
  const pitch = THREE.MathUtils.degToRad(num('pitch', 48));
  const yaw = THREE.MathUtils.degToRad(num('yaw', 0));
  target.y = H(target.x, target.z);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
}

// ground mesh (vertex coloured, rebuilt locally when craters are pressed)
const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES).rotateX(-Math.PI / 2);
const gpos = groundGeo.getAttribute('position') as THREE.BufferAttribute;
const gcol = new Float32Array(gpos.count * 3);
groundGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
function refreshGround() {
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i), z = gpos.getZ(i);
    const h = H(x, z);
    gpos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.cos(z * 1.3) * 2);
    const c = new THREE.Color().setRGB(0.2 + n * 0.05, 0.3 + n * 0.06, 0.12);
    if (h < -0.2) c.setRGB(0.36, 0.3, 0.2);
    if (baseH(x, z) - h > 0.01) c.setRGB(0.22, 0.17, 0.12);
    gcol[i * 3] = c.r;
    gcol[i * 3 + 1] = c.g;
    gcol[i * 3 + 2] = c.b;
  }
  gpos.needsUpdate = true;
  (groundGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  groundGeo.computeVertexNormals();
}
refreshGround();
const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
ground.receiveShadow = true;
scene.add(ground);
const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d4a5a, roughness: 0.1, transparent: true, opacity: 0.85 }));
water.position.set(13, WATER_LEVEL, 7);
scene.add(water);

// effects + destruction (+ a toy terrain deform so craters show in the preview)
const realFx = new Effects({ scene, camera, renderer, getHeight: (x, z) => map.surfaceAt(x, z) });
realFx.setSunDirection(sun.position.clone().normalize());
/** fx=0: no particles at all (to judge the chunk physics without the smoke). */
const noop = () => {};
const stubEmitter = { setPosition: noop, setIntensity: noop, dispose: noop };
const effects: Effects = params.get('fx') === '0'
  ? (new Proxy(realFx, {
      get(t, k) {
        if (k === 'update') return (dt: number, time: number) => t.update(dt, time);
        if (k === 'createEmitter') return () => stubEmitter;
        if (k === 'ctx' || k === 'context') return undefined;
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function' ? noop : v;
      },
    }) as Effects)
  : realFx;
let groundDirty = false;
const terrain = {
  renderHeight: (x: number, y: number) => H(x, y),
  deform: (x: number, y: number, r: number, d: number) => {
    bumps.push({ x, z: y, r, d });
    groundDirty = true;
  },
};
const rubble = new Rubble(map);
scene.add(rubble.mesh);
let destruction = new Destruction(scene, effects, map);
destruction.setTerrain(terrain);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
if (params.get('q') !== 'low') composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 1.1));
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------------------------
// Scenario

interface Actor {
  id: number;
  type: string;
  model: ModelInstance;
  anim: ModelAnimState;
  kind: 'building' | 'vehicle' | 'aircraft' | 'infantry';
  dieAt: number;
  how: string;
  dead: boolean;
  deadT: number;
  pose: boolean;
  health: number;
  fp: [number, number];
  alt: number;
  team: number;
}

const actors: Actor[] = [];
let nextId = 1;
let time = 0;
let labels: HTMLDivElement[] = [];

function anim(): ModelAnimState {
  return { time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0.6, harvesting: false, charge: 1, dying: 0, altitude: 0 };
}

const pendingLabels: [string, number, number][] = [];
function label(text: string, x: number, z: number) {
  pendingLabels.push([text, x, z]);
}
function flushLabels() {
  camera.updateMatrixWorld();
  for (const [text, x, z] of pendingLabels.splice(0)) labelNow(text, x, z);
}
function labelNow(text: string, x: number, z: number) {
  const v = new THREE.Vector3(x, H(x, z), z).project(camera);
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = `position:absolute;left:${((v.x + 1) / 2) * innerWidth}px;top:${((1 - v.y) / 2) * innerHeight + 8}px;transform:translateX(-50%);color:#fff;font:11px system-ui;background:rgba(10,14,20,.6);padding:1px 5px;border-radius:3px;pointer-events:none`;
  document.body.appendChild(d);
  labels.push(d);
}

function add(type: string, x: number, z: number, opts: Partial<Actor> & { yaw?: number; team?: THREE.Color } = {}): Actor {
  const def = UNITS[type];
  const b = BUILDINGS[type];
  const kind: Actor['kind'] = b ? 'building' : def?.kind === 'infantry' ? 'infantry' : def?.kind === 'aircraft' ? 'aircraft' : 'vehicle';
  const teamC = opts.team ?? (b ? SOVIET : nextId % 2 ? ALLIED : SOVIET);
  const model = createModel(type, teamC);
  const alt = opts.alt ?? 0;
  model.root.position.set(x, map.surfaceAt(x, z) + alt, z);
  model.root.rotation.y = opts.yaw ?? 0;
  scene.add(model.root);
  const a: Actor = {
    id: nextId++, type, model, anim: anim(), kind, dieAt: opts.dieAt ?? -1, how: opts.how ?? 'blown', dead: false, deadT: 0, pose: false,
    health: opts.health ?? 1, fp: (b?.size as [number, number]) ?? [1, 1], alt, team: teamC.getHex(),
  };
  a.anim.health = a.health;
  a.anim.altitude = alt;
  if (kind === 'building') destruction.prepare(type, a.fp);
  actors.push(a);
  return a;
}

function kill(a: Actor) {
  a.dead = true;
  a.deadT = 0;
  const p = a.model.root.position;
  const team = a.team;
  if (a.kind === 'building') {
    destruction.crater(p.x, p.z, Math.max(...a.fp) * 0.55, 0.05);
    effects.explosion(p.clone().setY(p.y + 0.3), 'building', Math.max(...a.fp));
    effects.scorch(p, Math.max(...a.fp) * 1.1);
    if (!destruction.collapse(a.id, a.type, team, a.model, a.fp)) a.model.root.visible = false;
  } else if (a.kind === 'vehicle' || a.kind === 'aircraft') {
    if (a.type === 'dtrk') destruction.demoBlast(p.x, p.z, 1);
    else destruction.onImpact(p.x, p.z, p.y, 'large', 1);
    effects.explosion(p.clone().setY(p.y + 0.25), 'large', 1);
    effects.scorch(p, 1.1);
    a.model.setVariant?.(BodyVariant.Charred);
    a.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material as THREE.Material).name.startsWith('body')) m.visible = false;
    });
    const def = UNITS[a.type];
    destruction.vehicleDeath(a.id, a.model, team, a.how, !!def?.tracked, a.kind === 'vehicle' && !def?.tracked, a.alt);
  } else {
    a.anim.deathKind = a.how as ModelAnimState['deathKind'];
    if (a.how === 'crushed') {
      effects.bloodSplat(p);
      a.model.root.scale.set(1.2, 0.08, 1.2);
    } else if (a.how === 'burn' || a.how === 'electro') effects.scorch(p, 0.35);
    if (a.how === 'blown') effects.explosion(p.clone().add(new THREE.Vector3(0.25, 0.05, 0.1)), 'medium', 0.7);
    a.pose = !destruction.infantryDeath(a.id, a.model, a.how);
    if (a.how === 'burn') effects.explosion(p.clone().setY(p.y + 0.1), 'fire', 0.6);
    if (a.how === 'electro') effects.explosion(p.clone().setY(p.y + 0.15), 'electric', 0.6);
  }
}

function idsOr(def: string[]): string[] {
  return params.has('ids') ? params.get('ids')!.split(',').filter(Boolean) : def;
}

function build() {
  for (const l of labels) l.remove();
  labels = [];
  let dist = 14;
  const sc = scene0;
  if (sc === 'buildings' || sc === 'all') {
    const ids = idsOr(sc === 'all' ? ['weap', 'powr', 'tsla'] : ['fact', 'powr', 'proc', 'dome', 'tsla', 'gun', 'silo']);
    let x = -((ids.length - 1) * 3.4) / 2;
    ids.forEach((id, i) => {
      add(id, x, sc === 'all' ? -1 : 0, { dieAt: 1 + i * 0.6 });
      x += 3.4;
    });
    dist = sc === 'all' ? 17 : 15 + ids.length;
  }
  if (sc === 'damage') {
    const ids = idsOr(['powr', 'weap', 'proc']);
    const hs = [1, 0.45, 0.2];
    ids.forEach((id, i) => hs.forEach((h, k) => add(id, (k - 1) * 3.6, (i - (ids.length - 1) / 2) * 3.6, { health: h })));
    dist = 18;
  }
  if (sc === 'vehicles' || sc === 'all') {
    const ids = idsOr(sc === 'all' ? ['3tnk', '2tnk', 'jeep', 'ttnk'] : ['1tnk', '2tnk', '3tnk', '4tnk', 'jeep', 'apc', 'harv', 'v2rl', 'ttnk', 'ctnk']);
    const z = sc === 'all' ? 3 : -3.2;
    let x = -((ids.length - 1) * 1.5) / 2;
    ids.forEach((id, i) => {
      add(id, x, z + (i % 2) * 0.5, { dieAt: 1 + i * 0.25, yaw: 0.4 + i * 0.7, how: i % 3 === 2 ? 'normal' : 'blown' });
      x += 1.5;
    });
    if (sc === 'vehicles') add('heli', 2, 1.5, { dieAt: 1.2, alt: 1.6, yaw: 0.8 });
    if (sc === 'vehicles') dist = 15;
  }
  if (sc === 'infantry' || sc === 'all') {
    const kinds = ['normal', 'blown', 'burn', 'electro', 'bite', 'crushed'];
    const ids = idsOr(sc === 'all' ? ['e1', 'e3'] : ['e1', 'e2', 'e3', 'shok']);
    ids.forEach((id, r) =>
      kinds.forEach((k, i) => {
        const a = add(id, (i - 2.5) * 0.9 + (sc === 'all' ? 6 : 0), (r - (ids.length - 1) / 2) * 0.9 + (sc === 'all' ? 3 : 0), { dieAt: 0.8 + i * 0.1, how: k, yaw: 0.3 });
        if (r === 0 && sc !== 'all') label(k, a.model.root.position.x, a.model.root.position.z - 0.6);
      }),
    );
    if (sc === 'infantry') dist = 8;
  }
  if (sc === 'aftermath') {
    add('qtnk', -4, 0, { yaw: 0.6 });
    add('dtrk', 3, 0, { dieAt: 2.2, yaw: -0.4 });
    add('ctnk', -1.5, 2.5, { yaw: 1.2 });
    dist = 15;
  }
  if (sc === 'craters') dist = 12;
  placeCamera(num('dist', dist));
  if (scene0 === 'buildings' || scene0 === 'vehicles' || scene0 === 'all') {
    for (const a of actors) if (a.kind !== 'infantry' && a.kind !== 'aircraft') label(a.type, a.model.root.position.x, a.model.root.position.z + 1.2);
  }
  if (params.get('labels') !== '0') flushLabels();
  else pendingLabels.length = 0;
}

function reset() {
  for (const a of actors) a.model.dispose();
  actors.length = 0;
  destruction.dispose();
  scene.remove(rubble.mesh);
  bumps.length = 0;
  refreshGround();
  destruction = new Destruction(scene, effects, map);
  destruction.setTerrain(terrain);
  scene.add(rubble.mesh);
  rubble.clear(-100, -100, 300, 300);
  time = 0;
  build();
}

let madT = 0;
function step(dt: number) {
  time += dt;
  for (const a of actors) {
    a.anim.time = time;
    a.anim.dt = dt;
    if (!a.dead && a.dieAt >= 0 && time >= a.dieAt) kill(a);
    if (a.dead) {
      a.deadT += dt;
      if (a.kind === 'infantry' && (a.pose || a.how === 'crushed')) {
        a.anim.dying = Math.min(1, a.deadT / 0.9);
        if (a.how !== 'crushed') a.model.update(a.anim);
      }
      continue;
    }
    a.anim.health = a.health;
    a.anim.powered = true;
    if (a.kind === 'building') {
      const p = a.model.root.position;
      destruction.buildingDamage(a.id, a.type, a.fp, p.x, p.y, p.z, a.health, true, a.model, a.anim);
    }
    // the M.A.D. tank deploys and pulses
    if (a.type === 'qtnk') {
      a.anim.deployed = time > 0.8 ? 1 : 0;
      a.anim.charge = time > 1.5 ? ((time - 1.5) % 1.6) / 1.6 : 0;
      if (time > 1.5 && Math.floor((time - 1.5) / 1.6) !== Math.floor((time - dt - 1.5) / 1.6)) {
        destruction.madPulse(a.model.root.position.x, a.model.root.position.z, 3.5);
      }
    }
    // the chrono tank jumps back and forth
    if (a.type === 'ctnk' && time > 1 && Math.floor(time / 3) !== Math.floor((time - dt) / 3)) {
      const p = a.model.root.position;
      const nx = p.x < 0 ? 2.5 : -1.5, nz = p.z;
      destruction.chronoJump(p.x, p.z, nx, nz);
      p.set(nx, H(nx, nz), nz);
    }
    a.model.update(a.anim);
  }
  if (scene0 === 'craters') {
    madT += dt;
    if (madT > 0.7) {
      madT = 0;
      const x = (Math.random() - 0.5) * 8, z = (Math.random() - 0.5) * 6;
      const kinds = ['medium', 'large', 'huge'] as const;
      const k = kinds[Math.floor(Math.random() * 3)];
      destruction.onImpact(x, z, H(x, z), k, 1);
      effects.explosion(new THREE.Vector3(x, H(x, z) + 0.1, z), k, 1);
    }
  }
  destruction.update(dt, time);
  effects.update(dt, time);
  if (groundDirty) {
    groundDirty = false;
    refreshGround();
  }
  if (play && loopT > 0 && time > loopT) reset();
}

build();
if (tTarget > 0) {
  const n = Math.round(tTarget * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
}
const info = document.createElement('div');
info.style.cssText = 'position:absolute;left:8px;top:6px;color:#e8eef6;font:12px system-ui;background:rgba(10,14,20,.6);padding:3px 8px;border-radius:4px';
document.body.appendChild(info);
(window as unknown as { __dest: unknown }).__dest = { destruction: () => destruction, step, actors, renderer };

const timer = new THREE.Timer();
function frame(ts?: number) {
  timer.update(ts);
  if (play) step(Math.min(timer.getDelta(), 1 / 20));
  composer.render();
  const st = destruction.stats();
  info.textContent = `destroy=${scene0} · t=${time.toFixed(2)} · collapses ${st.collapses} · bodies ${st.bodies} (${st.awake} awake) · ragdolls ${st.ragdolls} · debris ${st.pieces} · craters ${st.craters} · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
