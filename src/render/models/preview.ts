/**
 * Model preview page (preview-models.html).
 * URL params:
 *   ids=1tnk,2tnk      subset of ids (default: all)
 *   zoom=2             closer camera (divides distance)
 *   dist=24            camera distance before zoom (default: 24, or more to fit the grid)
 *   anim=1             animate (moving/firing/door/charge/load cycling)
 *   t=3.2              fixed time for static shots
 *   powered=0          unpowered structures
 *   health=0.3         health fraction
 *   dying=0.6&death=burn   infantry death pose
 *   firing=1           recoil pose
 *   door=1 charge=0.5 load=0.3 harvesting=1 moving=1
 *   turret=0.6         turret yaw (radians)
 *   alt=0.8            aircraft altitude
 *   team=ff8800        force a team colour for all models
 *   yaw=0.4            rotate units (radians, heading)
 *   cols=10            max grid width in cells
 *   dc=1               show mesh (draw call) counts in labels
 *   nolabel=1          hide labels
 *   gap=0.5            spacing multiplier for small items
 *   sub=1 para=1 deployed=1 cloak=1   submarine dive, parachute, deploy and cloak anim fields (anim=1 cycles them)
 *   dying=0.5          also lists & sinks ships
 *   water=0            no water plane under naval models
 *   pitch=25           camera pitch in degrees (default 55)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { UNITS, BUILDINGS } from '../../data/rules';
import { createModel, createProjectileModel, listModelIds, modelAliasOf, prewarmModels } from './index';
import type { ModelAnimState, ModelInstance, ProjectileModelKind } from './types';
import { setModelSnow } from './materials';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
const flag = (k: string, d: boolean) => (params.has(k) ? params.get(k) !== '0' : d);

const ALLIED = new THREE.Color(0x3d7be0);
const SOVIET = new THREE.Color(0xd23a2c);
const NEUTRAL = new THREE.Color(0xb8a878);

// ---------------------------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const hemi = new THREE.HemisphereLight(0xc4dcff, 0x56683a, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdcb0, 2.5);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------
const allIds = listModelIds();
const ids = params.has('ids') ? params.get('ids')!.split(',').map((s) => s.trim()).filter(Boolean) : allIds;

const t0 = performance.now();
setModelSnow(num('snow', 0)); // snow=1: winter snow cover on the models
prewarmModels(ids.filter((i) => allIds.includes(i)));
const buildMs = performance.now() - t0;

interface Item {
  id: string;
  model: ModelInstance;
  x: number;
  z: number;
  phase: number;
  kind: 'infantry' | 'vehicle' | 'aircraft' | 'naval' | 'building' | 'other';
  water: boolean;
  proj?: THREE.Object3D;
}

/** Preview metadata for ids that may not (yet) be in rules.ts. */
type PKind = 'infantry' | 'vehicle' | 'aircraft' | 'naval' | 'building' | 'defense';
const EXTRA: Record<string, { kind: PKind; side: 'allies' | 'soviet' | 'both'; size: [number, number]; water?: boolean }> = {
  syrd: { kind: 'building', side: 'allies', size: [3, 3], water: true },
  spen: { kind: 'building', side: 'soviet', size: [3, 3], water: true },
  syrf: { kind: 'building', side: 'allies', size: [3, 3], water: true },
  spef: { kind: 'building', side: 'soviet', size: [3, 3], water: true },
  facf: { kind: 'building', side: 'allies', size: [3, 3] },
  weaf: { kind: 'building', side: 'allies', size: [3, 3] },
  domf: { kind: 'building', side: 'allies', size: [2, 2] },
  pt: { kind: 'naval', side: 'allies', size: [1.1, 0.6] },
  dd: { kind: 'naval', side: 'allies', size: [1.6, 0.7] },
  ca: { kind: 'naval', side: 'allies', size: [2.5, 0.9] },
  lst: { kind: 'naval', side: 'both', size: [1.5, 0.8] },
  ss: { kind: 'naval', side: 'soviet', size: [1.4, 0.5] },
  spy: { kind: 'infantry', side: 'allies', size: [0.6, 0.7] },
  thf: { kind: 'infantry', side: 'allies', size: [0.6, 0.7] },
  mnly: { kind: 'vehicle', side: 'both', size: [1.3, 1.1] },
  mgg: { kind: 'vehicle', side: 'allies', size: [1.3, 1.1] },
  mrj: { kind: 'vehicle', side: 'allies', size: [1.3, 1.1] },
  tran: { kind: 'aircraft', side: 'both', size: [1.6, 1.4] },
  badr: { kind: 'aircraft', side: 'soviet', size: [1.8, 1.8] },
  u2: { kind: 'aircraft', side: 'allies', size: [1.8, 1.8] },
  gap: { kind: 'defense', side: 'allies', size: [1, 2] },
  hbox: { kind: 'defense', side: 'allies', size: [1, 1] },
  minp: { kind: 'defense', side: 'soviet', size: [1, 1] },
  minv: { kind: 'defense', side: 'allies', size: [1, 1] },
};

function kindOf(id: string): PKind | 'other' {
  const u = UNITS[id];
  if (u) return u.kind as PKind;
  const b = BUILDINGS[id];
  if (b) return b.category === 'defense' ? 'defense' : 'building';
  return EXTRA[id]?.kind ?? 'other';
}

function teamFor(id: string, i: number): THREE.Color {
  if (params.has('team')) return new THREE.Color(parseInt(params.get('team')!, 16));
  if (id === 'harv' || id === 'silo') return NEUTRAL;
  const def = UNITS[id] ?? BUILDINGS[id];
  const side = def ? (def.owner.length === 1 ? def.owner[0] : 'both') : EXTRA[id]?.side;
  if (!side) return NEUTRAL;
  if (side !== 'both') return side === 'allies' ? ALLIED : SOVIET;
  return i % 2 === 0 ? ALLIED : SOVIET;
}

function footprint(id: string): [number, number] {
  const b = BUILDINGS[id] ?? BUILDINGS[modelAliasOf(id)];
  if (b) return b.size;
  const u = UNITS[id];
  if (!u) return EXTRA[id]?.size ?? [1, 1];
  if (u.kind === 'infantry') return [0.6, 0.7];
  if (u.kind === 'aircraft') return [1.4, 1.4];
  if ((u.kind as string) === 'naval') return EXTRA[id]?.size ?? [1.6, 0.7];
  return [1.3, 1.1];
}

const order = (id: string): number => {
  const k = kindOf(id);
  if (EXTRA[id]?.water) return 6;
  return k === 'infantry' ? 0 : k === 'vehicle' ? 1 : k === 'aircraft' ? 2 : k === 'naval' ? 5 : k === 'building' ? 3 : k === 'defense' ? 4 : 7;
};
const onWater = (id: string) => kindOf(id) === 'naval' || !!EXTRA[id]?.water;
const sorted = params.has('ids') ? ids : [...ids].sort((a, b) => order(a) - order(b));

const maxW = num('cols', Math.max(8, Math.ceil(Math.sqrt(sorted.length * 4))));
const items: Item[] = [];
let cx = 0;
let cz = 0;
let rowDepth = 0;
let lastOrder = -1;
let onWaterPrev = false;
const waterRects: THREE.Box3[] = [];
const bbox = new THREE.Box3();
let n = 0;
for (const id of sorted) {
  if (id === 'proj') continue;
  const [fx, fz] = footprint(id);
  const gap = num('gap', 1);
  const w = Math.max(1.0 * gap, fx + 0.5 * gap);
  const d = Math.max(1.1, fz + 0.8);
  const o = order(id);
  if ((cx + w > maxW && cx > 0) || (o !== lastOrder && lastOrder >= 0 && (!params.has('ids') || onWater(id) !== onWaterPrev) && o !== 2)) {
    cx = 0;
    cz += rowDepth;
    rowDepth = 0;
  }
  lastOrder = o;
  onWaterPrev = onWater(id);
  const x = cx + w / 2;
  const z = cz + d / 2;
  cx += w;
  rowDepth = Math.max(rowDepth, d);
  const def = UNITS[id] ?? BUILDINGS[id];
  const model = createModel(id, teamFor(id, n++));
  model.root.position.set(x, 0, z - 0.2);
  scene.add(model.root);
  const pk = kindOf(id);
  const kind: Item['kind'] = pk === 'defense' ? 'building' : pk;
  const water = onWater(id) && flag('water', true);
  if (water) waterRects.push(new THREE.Box3(new THREE.Vector3(cx - w, 0, cz), new THREE.Vector3(cx, 0, cz + d)));
  if (kind !== 'building' && kind !== 'other') model.root.rotation.y = num('yaw', 0.0);
  void def;
  const label = document.createElement('div');
  label.className = 'lbl';
  let meshes = 0;
  model.root.traverse((ob) => {
    if ((ob as THREE.Mesh).isMesh) meshes++;
  });
  label.textContent = `${id}${def && num('zoom', 1) >= 2 ? ' · ' + def.name : ''}${flag('dc', false) ? ` [${meshes}]` : ''}`;
  const lo = new CSS2DObject(label);
  lo.position.set(x, 0, z - 0.2 + fz / 2 + 0.25);
  if (!flag('nolabel', false)) scene.add(lo);
  items.push({ id, model, x, z, phase: (n * 0.37) % 1, kind, water });
  bbox.expandByPoint(new THREE.Vector3(cx - w, 0, cz));
  bbox.expandByPoint(new THREE.Vector3(cx, 0, cz + d));
}

// projectile row (only when showing everything or ids contains 'proj')
let projCenter: THREE.Vector3 | null = null;
if (!params.has('ids') || ids.includes('proj')) {
  const kinds: ProjectileModelKind[] = ['shell', 'missile', 'scud', 'grenade', 'nuke', 'fireball', 'torpedo', 'depthcharge', 'bomb'];
  cz += rowDepth;
  kinds.forEach((k, i) => {
    const o = createProjectileModel(k);
    o.position.set(0.6 + i * 1.1, 0.35, cz + 0.4);
    o.rotation.y = 0.3;
    scene.add(o);
    const label = document.createElement('div');
    label.className = 'lbl';
    label.textContent = `proj:${k}`;
    const lo = new CSS2DObject(label);
    lo.position.set(0.6 + i * 1.1, 0, cz + 0.85);
    scene.add(lo);
  });
  bbox.expandByPoint(new THREE.Vector3(10.5, 0, cz + 1.2));
  projCenter = new THREE.Vector3(0.6 + 4 * 1.1, 0.35, cz + 0.4);
}

// ground
const groundSize = 200;
const groundTex = (() => {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#5d7a3a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(70,98,40,0.5)' : v < 0.85 ? 'rgba(110,138,70,0.4)' : 'rgba(130,120,80,0.35)';
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(groundSize / 4, groundSize / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
})();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(groundSize, groundSize),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// water under naval models: the model's y = 0 is the water surface; hulls below it are hidden like in game
if (waterRects.length) {
  const wmat = new THREE.MeshStandardMaterial({ color: 0x0f3442, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.9, depthWrite: true });
  const merged = new THREE.Box3();
  for (const r of waterRects) merged.union(r);
  // one sheet per contiguous row block (rows are separated by land items anyway)
  for (const r of waterRects) {
    const sz = r.getSize(new THREE.Vector3());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sz.x + 0.02, sz.z + 0.02), wmat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.min.x + r.max.x) / 2, 0.004, (r.min.z + r.max.z) / 2);
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
  }
  // dark pit below the sheet so hulls under the surface read as submerged rather than buried
  void merged;
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------
const center = bbox.getCenter(new THREE.Vector3());
const size = bbox.getSize(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
const pitch = THREE.MathUtils.degToRad(num('pitch', 55));
const vFov = THREE.MathUtils.degToRad(camera.fov);
const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
const fitW = (size.x * 1.08) / 2 / Math.tan(hFov / 2);
const fitD = (size.z * Math.sin(pitch) * 1.15) / 2 / Math.tan(vFov / 2);
const baseDist = num('dist', Math.max(24, fitW, fitD));
const dist = baseDist / num('zoom', 1);
const target = center.clone();
if (items.length) {
  target.set(0, 0, 0);
  for (const it of items) target.add(it.model.root.position);
  target.multiplyScalar(1 / items.length);
  target.y = 0.15;
  if (!params.has('ids')) target.copy(center);
}
if (projCenter && items.length === 0) target.copy(projCenter);
camera.position.set(target.x, target.y + Math.sin(pitch) * dist, target.z + Math.cos(pitch) * dist);
camera.lookAt(target);

// sun follows the layout
const sunDir = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();
sun.position.copy(target).addScaledVector(sunDir, 60);
sun.target.position.copy(target);
const ext = Math.max(size.x, size.z) * 0.62 + 2;
sun.shadow.camera.left = -ext;
sun.shadow.camera.right = ext;
sun.shadow.camera.top = ext;
sun.shadow.camera.bottom = -ext;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.updateProjectionMatrix();

// ---------------------------------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------------------------------
const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------------------------
// Per-type stats: meshes (draw calls) and triangles. Exposed on window.__modelStats.
// ---------------------------------------------------------------------------------------------
function measure(root: THREE.Object3D): { meshes: number; tris: number; shadow: number } {
  let meshes = 0;
  let tris = 0;
  let shadow = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    if (m.castShadow) shadow++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { meshes, tris: Math.round(tris), shadow };
}
const statIds = flag('stats', false) ? allIds : ids.filter((i) => allIds.includes(i));
const modelStats: Record<string, { meshes: number; tris: number; shadow: number }> = {};
for (const id of statIds) {
  const m = createModel(id, ALLIED);
  m.update({
    time: 0, dt: 0.016, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1,
    door: 0, load: 0.8, harvesting: false, charge: 1, dying: 0, altitude: 1,
  });
  modelStats[id] = measure(m.root);
  m.dispose();
}
(window as unknown as { __modelStats: typeof modelStats }).__modelStats = modelStats;
if (flag('stats', false)) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:absolute;right:8px;top:6px;margin:0;color:#e8eef6;font:11px monospace;background:rgba(10,14,20,0.75);padding:6px 8px;border-radius:4px;z-index:3;max-height:96vh;overflow:auto';
  pre.textContent = 'id      draws  tris  shadow\n' + Object.entries(modelStats)
    .map(([id, v]) => `${id.padEnd(7)} ${String(v.meshes).padStart(4)} ${String(v.tris).padStart(6)} ${String(v.shadow).padStart(4)}`)
    .join('\n');
  document.body.appendChild(pre);
}

// ---------------------------------------------------------------------------------------------
// Stats overlay (instance creation speed)
// ---------------------------------------------------------------------------------------------
const info = document.getElementById('info')!;
{
  const reps = 200;
  const probe = ids.filter((i) => allIds.includes(i));
  const tA = performance.now();
  for (let k = 0; k < reps; k++) {
    const m = createModel(probe[k % probe.length] ?? '1tnk', ALLIED);
    m.dispose();
  }
  const per = (performance.now() - tA) / reps;
  let meshes = 0;
  for (const it of items) {
    it.model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
  }
  info.textContent = `${items.length} models · templates built in ${buildMs.toFixed(0)} ms · createModel ${(per * 1000).toFixed(0)} µs · ${meshes} meshes (${(meshes / Math.max(1, items.length)).toFixed(1)}/model)`;
}

// ---------------------------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------------------------
const anim = flag('anim', false);
const fixedT = params.has('t') ? num('t', 0) : null;
const state: ModelAnimState = {
  time: 0,
  dt: 0,
  moving: false,
  speed: 0,
  firing: 0,
  firingMuzzle: 0,
  powered: true,
  health: 1,
  door: 0,
  load: 0,
  harvesting: false,
  charge: 1,
  dying: 0,
  deathKind: 'normal',
  altitude: 0,
};

const timer = new THREE.Timer();
let time = fixedT ?? 0;
function frame(ts?: number) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (fixedT === null) time += dt;
  for (const it of items) {
    const tt = time + it.phase * 7;
    const isUnit = it.kind === 'infantry' || it.kind === 'vehicle' || it.kind === 'aircraft' || it.kind === 'naval';
    state.time = tt;
    state.dt = fixedT === null ? dt : 1 / 60;
    state.powered = flag('powered', true);
    state.health = num('health', 1);
    state.deathKind = (params.get('death') as ModelAnimState['deathKind']) ?? 'normal';
    state.altitude = it.kind === 'aircraft' ? num('alt', 0.7) : 0;
    state.submerged = num('sub', 0);
    state.parachute = num('para', 0);
    state.deployed = num('deployed', 0);
    state.cloak = num('cloak', 0);
    if (anim) {
      const cyc = (tt % 3) / 3;
      state.moving = isUnit && (tt % 8) < 5;
      state.speed = state.moving ? 1 : 0;
      const since = tt % 2.2;
      state.firing = since < 0.25 ? 1 - since / 0.25 : 0;
      state.firingMuzzle = Math.floor(tt / 2.2) % 4;
      state.door = Math.min(1, Math.max(0, Math.sin(tt * 0.9) * 0.8 + 0.5));
      state.charge = Math.min(1, ((tt * 0.22) % 1.3));
      state.load = 0.5 + 0.5 * Math.sin(tt * 0.45);
      state.harvesting = Math.sin(tt * 0.7) > 0;
      state.dying = params.has('dying') ? Math.min(1, (tt % 4) / 2) : 0;
      const slow = 0.5 - 0.5 * Math.cos(tt * 0.5);
      state.submerged = params.has('sub') ? num('sub', 0) : slow > 0.5 ? 1 : 0;
      state.deployed = params.has('deployed') ? num('deployed', 0) : slow;
      state.cloak = params.has('cloak') ? num('cloak', 0) : slow;
      state.parachute = params.has('para') ? num('para', 0) : Math.min(1, Math.max(0, 1.4 - ((tt * 0.25) % 1.4)));
      if (it.model.turret) it.model.turret.rotation.y = Math.sin(tt * 0.4) * 0.8;
    } else {
      state.moving = flag('moving', false);
      state.speed = state.moving ? 1 : 0;
      state.firing = num('firing', 0);
      state.firingMuzzle = num('muzzle', 0);
      state.door = num('door', 0);
      state.charge = num('charge', 1);
      state.load = num('load', 0.75);
      state.harvesting = flag('harvesting', false);
      state.dying = num('dying', 0);
      if (it.model.turret) it.model.turret.rotation.y = num('turret', 0);
    }
    it.model.root.position.y = state.altitude ?? 0;
    it.model.update(state);
  }
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
