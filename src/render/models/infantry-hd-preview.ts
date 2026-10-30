/**
 * Dev page (dev/preview-infantry.html): contact sheets of the HD infantry clips, and HD next to procedural.
 *
 *   ?type=e1&fac=soviet            the soldier (default e1 / soviet)
 *   &clips=rifle.,death.           clip name prefixes (comma list; default: the type's set + common clips)
 *   &frames=6                      frames per clip (spread over the clip)
 *   &live=1                        play the clips instead of still frames
 *   &cmp=1                         the procedural model at the start of every row (Standard detail)
 *   &types=e1,e2,e3&state=idle     one row of soldiers (several types) in one clip state
 *   &team=d23a2c &yaw=0.6 &pitch=28 &dist=…  &muzzle=1 (red dots at the CPU-computed muzzles)
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { createModel, requestHdModel } from './index';
import { setHdModels } from './hd';
import { setModelDetail } from './builder';
import { infantryAnimatorOf, infantryHdStatus } from './infantry-hd';
import { TYPE_SET } from './infantry-hd-anim';
import { applyVisualScale } from '../scale';
import type { ModelAnimState, ModelInstance } from './types';
import { UNITS } from '../../data/rules';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
const info = document.getElementById('info')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.style.position = 'absolute';
labels.domElement.style.top = '0';
labels.domElement.style.pointerEvents = 'none';
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6f8090);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xc4dcff, 0x56683a, 0.9));
const sun = new THREE.DirectionalLight(0xffe2c0, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6b6a52, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const STATE: ModelAnimState = { time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0, harvesting: false, charge: 1, dying: 0 };

function label(text: string, x: number, z: number): void {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.textContent = text;
  const o = new CSS2DObject(d);
  o.position.set(x, 0.02, z);
  scene.add(o);
}

async function waitHd(type: string, fac: 'soviet' | 'allies'): Promise<boolean> {
  for (let i = 0; i < 400; i++) {
    const st = requestHdModel(type, fac);
    if (st === 'ready') return true;
    if (st === 'none') return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function main() {
  setModelDetail(2);
  setHdModels(true, 'high');
  const fac = (params.get('fac') === 'allies' ? 'allies' : 'soviet') as 'soviet' | 'allies';
  const team = new THREE.Color(parseInt(params.get('team') ?? (fac === 'soviet' ? 'c8372c' : '3d7be0'), 16));
  const types = (params.get('types') ?? params.get('type') ?? 'e1').split(',');
  for (const t of types) if (!(await waitHd(t, fac))) info.textContent = `no HD model for ${t} (${JSON.stringify(infantryHdStatus())})`;
  const items: { m: ModelInstance; dots: THREE.Mesh[] }[] = [];
  const frames = Math.max(1, Math.round(num('frames', 6)));
  const live = params.get('live') === '1';
  const yaw = num('yaw', -0.55);
  const cell = 0.62;
  const rowGap = num('gap', 0.78);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false });
  const dotGeo = new THREE.SphereGeometry(0.008, 6, 4);
  const place = (type: string, x: number, z: number, clipName: string | null, t: number, rate: number) => {
    const m = createModel(type, team, fac);
    applyVisualScale(m, 'infantry', type);
    m.root.position.set(x, 0, z);
    m.root.rotation.y = yaw;
    scene.add(m.root);
    const a = infantryAnimatorOf(m);
    if (a && clipName) {
      const c = a.lib.get(clipName);
      if (c) a.pin(c, t, rate);
    }
    m.update({ ...STATE, time: t });
    const dots: THREE.Mesh[] = [];
    if (params.get('muzzle') === '1') for (const mz of m.muzzles) { const d = new THREE.Mesh(dotGeo, dotMat); d.renderOrder = 9; scene.add(d); dots.push(d); void mz; }
    items.push({ m, dots });
    return m;
  };
  let rows = 0;
  if (params.has('types')) {
    // a line-up: every type in one state
    const state = params.get('state') ?? 'idle';
    types.forEach((t, i) => {
      const set = TYPE_SET[t] ?? 'rifle';
      const probe = createModel(t, team, fac);
      const lib = infantryAnimatorOf(probe)?.lib;
      const clip = lib?.forState(set, state as never) ?? null;
      probe.dispose();
      place(t, i * cell * 1.15, 0, clip?.name ?? null, num('t', 0.3), live ? 1 : 0);
      label(UNITS[t]?.name ?? t, i * cell * 1.15, 0.42);
      if (params.get('cmp') === '1') {
        setHdModels(false);
        const p = createModel(t, team, fac);
        setHdModels(true, 'high');
        applyVisualScale(p, 'infantry', t);
        p.root.position.set(i * cell * 1.15, 0, -0.9);
        p.root.rotation.y = yaw;
        p.update({ ...STATE, time: 0.3 });
        scene.add(p.root);
      }
    });
    rows = params.get('cmp') === '1' ? 2 : 1;
  } else if (params.has('rows')) {
    // rows=e4:flamer.aim,e2:grenade.throw,...: any type / clip per row (contact sheets across sets)
    const list = params.get('rows')!.split(',').map((r) => r.split(':'));
    for (const [t] of list) if (!(await waitHd(t, fac))) info.textContent = `no HD model for ${t}`;
    list.forEach(([type, name], r) => {
      const z = r * rowGap;
      const probe = createModel(type, team, fac);
      const c = infantryAnimatorOf(probe)?.lib.get(name);
      probe.dispose();
      if (!c) return;
      label(`${type} · ${name}`, -0.8, z);
      for (let f = 0; f < frames; f++) {
        const t = c.duration * (frames > 1 ? f / (c.loop ? frames : frames - 1) : 0);
        place(type, f * cell, z, name, t, live ? 1 : 0);
      }
    });
    rows = list.length;
  } else {
    const type = types[0];
    const probe = createModel(type, team, fac);
    const lib = infantryAnimatorOf(probe)?.lib;
    probe.dispose();
    if (!lib) { info.textContent = `no HD rig for ${type}`; return; }
    const set = TYPE_SET[type] ?? 'rifle';
    const prefixes = (params.get('clips') ?? `${set}.,${set === 'flamer' ? 'rifle.,' : set === 'grenade' ? 'unarmed.,' : ''}para,death.`).split(',').filter(Boolean);
    const clips = lib.clips.filter((c) => prefixes.some((p) => c.name.startsWith(p)));
    clips.forEach((c, r) => {
      const z = r * rowGap;
      label(c.name, -0.75, z);
      for (let f = 0; f < frames; f++) {
        const t = live ? 0 : c.duration * (frames > 1 ? f / (c.loop ? frames : frames - 1) : 0);
        place(type, f * cell, z, c.name, live ? c.duration * f / frames : t, live ? 1 : 0);
      }
      if (params.get('cmp') === '1') {
        setHdModels(false);
        const p = createModel(type, team, fac);
        setHdModels(true, 'high');
        applyVisualScale(p, 'infantry', type);
        p.root.position.set(-0.45, 0, z);
        p.root.rotation.y = yaw;
        p.update({ ...STATE, time: 0.3 });
        scene.add(p.root);
      }
    });
    rows = clips.length;
  }
  // camera: frame the grid from the front-right, above
  const w = params.has('types') ? types.length * cell * 1.15 : frames * cell;
  const h = rows * rowGap;
  const cx = w / 2 - cell / 2;
  const cz = h / 2 - rowGap / 2;
  const pitch = THREE.MathUtils.degToRad(num('pitch', 30));
  // &ortho=1: an orthographic camera fitted to the grid (contact sheets: no perspective overlap between rows)
  const ortho = params.get('ortho') === '1';
  const aspect = innerWidth / innerHeight;
  let cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  if (ortho) {
    const sw = w + 1.4;
    const sh = h * Math.sin(pitch) + 0.6;
    const half = Math.max(sw / aspect, sh) / 2;
    cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.05, 200);
    cam.position.set(cx - 0.35 + 20 * 0, Math.sin(pitch) * 20, cz + Math.cos(pitch) * 20);
    cam.lookAt(cx - 0.35, 0.18, cz);
  } else {
    cam = new THREE.PerspectiveCamera(22, aspect, 0.05, 200);
    const dist = num('dist', Math.max(w / (2 * Math.tan(THREE.MathUtils.degToRad(11)) * aspect), h / (2 * Math.tan(THREE.MathUtils.degToRad(11)))) * 1.08 + 0.6);
    cam.position.set(cx, Math.sin(pitch) * dist + 0.2, cz + Math.cos(pitch) * dist);
    cam.lookAt(cx, 0.18, cz);
  }
  sun.position.set(cx + 3, 6, cz + 4);
  sun.target.position.set(cx, 0, cz);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -w; sc.right = w; sc.top = h + 2; sc.bottom = -h - 2;
  sc.updateProjectionMatrix();
  info.textContent = `${types.join(', ')} (${fac}) · ${items.length} soldiers · ${rows} rows · ${JSON.stringify(infantryHdStatus().loaded)}`;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    STATE.time += dt;
    for (const it of items) {
      if (live) it.m.update({ ...STATE, dt });
      it.m.root.updateMatrixWorld(true);
      it.m.muzzles.forEach((mz, i) => { if (it.dots[i]) mz.getWorldPosition(it.dots[i].position); });
    }
    renderer.render(scene, cam);
    labels.render(scene, cam);
    (window as unknown as { __infReady: number }).__infReady = ((window as unknown as { __infReady?: number }).__infReady ?? 0) + 1;
    requestAnimationFrame(loop);
  };
  loop();
}

main().catch((e) => { info.textContent = `error: ${(e as Error).message}`; console.error(e); });
