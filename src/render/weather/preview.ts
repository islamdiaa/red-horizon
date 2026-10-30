/**
 * Weather preview / test bed (dev/preview-weather.html).
 *
 * URL params:
 *   w=clear|rain|storm|snow|fog|dust   weather (default rain)
 *   from=KIND&at=S&fade=S              start with KIND, cross-fade to w at sim time `at` (default 2) over `fade` s
 *   tod=day|dusk|night                 lighting preset (same values as the game renderer)
 *   t=SECONDS                          fast-forward the simulation (fixed 1/30 steps, default 30); add pause=1 to freeze there
 *   strike=S[,S…]                      force a lightning strike at these sim times (spos=x,z to place it);  cloud=S[,S…] cloud flashes
 *   dist=N                             camera distance (default 26), cx/cz focus point
 *   q=0.2..1                           particle quality, seed=N
 *   bench=1                            CPU benchmark of Weather.update() (results via console.warn)
 *   frames=N                           stop rendering after N frames (cheap, stable screenshots with pause=1)
 *   hud=0                              hide the overlay
 * Keys: 1-6 switch weather, L strike, C cloud flash, arrows pan, wheel zoom.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Weather, WEATHER_KINDS, patchMaterialForWeather, type WeatherKind } from './index';

const params = new URLSearchParams(location.search);
const kind = (params.get('w') ?? 'rain') as WeatherKind;
const from = params.get('from') as WeatherKind | null;
const fadeAt = parseFloat(params.get('at') ?? '2');
const fade = parseFloat(params.get('fade') ?? '8');
const tod = (params.get('tod') ?? 'day') as 'day' | 'dusk' | 'night';
const tTarget = parseFloat(params.get('t') ?? '30');
const pause = params.get('pause') === '1';
const listParam = (k: string) => (params.get(k) ?? '').split(',').filter((s) => s !== '').map(Number);
const strikes = listParam('strike');
const clouds = listParam('cloud');
const spos = listParam('spos');
let dist = parseFloat(params.get('dist') ?? '26');
const bench = params.get('bench') === '1';
const showHud = params.get('hud') !== '0';
const maxFrames = parseInt(params.get('frames') ?? '0', 10);
const quality = parseFloat(params.get('q') ?? '1');
const seed = parseInt(params.get('seed') ?? '7', 10);
const MAP = 96;
const focus = new THREE.Vector2(parseFloat(params.get('cx') ?? '48'), parseFloat(params.get('cz') ?? '50'));
const WATER = -0.32;

// ---------------------------------------------------------------------------------------------
// Terrain: rolling hills, a lake, a ridge and a valley

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function getHeight(x: number, z: number): number {
  let h = 0.3 * Math.sin(x * 0.13) * Math.cos(z * 0.11) + 0.18 * Math.sin(x * 0.051 + z * 0.073) + 0.05 * Math.sin(x * 0.9 + 1.3) * Math.sin(z * 0.7);
  const lake = Math.hypot((x - 36) * 0.85, z - 44);
  h -= 1.3 * sstep(9.5, 3.5, lake);
  const ridge = Math.hypot((x - 64) * 0.7, (z - 37) * 1.2);
  h += 2.2 * sstep(11, 2, ridge);
  const valley = Math.abs(z - 58 - Math.sin(x * 0.12) * 3);
  h -= 0.55 * sstep(5, 0.5, valley) * sstep(70, 55, x);
  return h;
}

// ---------------------------------------------------------------------------------------------
// Renderer / scene (same lighting presets and post chain as src/render/renderer.ts)

interface Preset { sunColor: number; sunIntensity: number; elevation: number; hemiSky: number; hemiGround: number; hemiIntensity: number; env: number; exposure: number; bg: number; bloom: number }
const PRESETS: Record<string, Preset> = {
  day: { sunColor: 0xffeedd, sunIntensity: 2.5, elevation: 0.86, hemiSky: 0xb0c8ef, hemiGround: 0x5a4a32, hemiIntensity: 0.75, env: 0.25, exposure: 0.92, bg: 0x05070b, bloom: 0.5 },
  dusk: { sunColor: 0xffa868, sunIntensity: 2.6, elevation: 0.42, hemiSky: 0x8a98c8, hemiGround: 0x4a3426, hemiIntensity: 0.65, env: 0.22, exposure: 1.0, bg: 0x05070b, bloom: 0.65 },
  night: { sunColor: 0x86a0ff, sunIntensity: 0.85, elevation: 0.95, hemiSky: 0x22335c, hemiGround: 0x0a0908, hemiIntensity: 0.42, env: 0.1, exposure: 1.05, bg: 0x020305, bloom: 1.15 },
};
const preset = PRESETS[tod] ?? PRESETS.day;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = preset.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(preset.bg);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = preset.env;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 400);
function placeCamera(): void {
  const t = Math.min(1, Math.max(0, (dist - 9) / (52 - 9)));
  const pitch = 0.82 + (1.05 - 0.82) * t;
  const gy = Math.max(0, getHeight(focus.x, focus.y));
  camera.position.set(focus.x, gy + Math.sin(pitch) * dist, focus.y + Math.cos(pitch) * dist);
  camera.lookAt(focus.x, gy, focus.y);
  camera.updateMatrixWorld();
}
placeCamera();

const hemi = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, preset.hemiIntensity);
scene.add(hemi);
const sun = new THREE.DirectionalLight(preset.sunColor, preset.sunIntensity);
const sunDir = new THREE.Vector3(0.55, Math.tan(preset.elevation) * 0.9, 0.62).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
{
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 220;
}
sun.position.set(MAP / 2 + sunDir.x * 90, sunDir.y * 90, MAP / 2 + sunDir.z * 90);
sun.target.position.set(MAP / 2, 0, MAP / 2);
scene.add(sun, sun.target);
const baseSky = new THREE.Color(preset.hemiSky);
const baseGround = new THREE.Color(preset.hemiGround);
const greySky = new THREE.Color().setRGB(0.42, 0.45, 0.5);

const weather = new Weather({ scene, camera, renderer, getHeight, mapW: MAP, mapH: MAP, waterLevel: WATER, quality, seed });
(window as unknown as { wx: Weather }).wx = weather;

// ground
{
  const seg = MAP * 2;
  const g = new THREE.PlaneGeometry(MAP, MAP, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(MAP / 2, 0, MAP / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const sand = new THREE.Color().setRGB(0.6, 0.53, 0.38, THREE.SRGBColorSpace);
  const rock = new THREE.Color().setRGB(0.42, 0.4, 0.37, THREE.SRGBColorSpace);
  const road = new THREE.Color().setRGB(0.42, 0.36, 0.26, THREE.SRGBColorSpace);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = getHeight(x, z);
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 0.45 + Math.sin(z * 0.37) * 1.5) * Math.cos(z * 0.41 - x * 0.17);
    const n2 = 0.5 + 0.5 * Math.sin(x * 2.1 + z * 1.3) * Math.sin(z * 1.7 - x * 0.6);
    c.setRGB(0.2 + 0.07 * n + 0.02 * n2, 0.3 + 0.08 * n + 0.02 * n2, 0.12 + 0.03 * n, THREE.SRGBColorSpace);
    c.lerp(sand, sstep(-0.05, -0.3, h));
    c.lerp(rock, sstep(1.0, 1.8, h));
    const r = 1 - Math.min(1, Math.max(0, (Math.abs(x - 50 - Math.sin(z * 0.2) * 0.8) - 0.6) / 0.5));
    c.lerp(road, r * sstep(-0.1, 0.1, h) * (1 - sstep(1.0, 1.4, h)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  patchMaterialForWeather(mat, weather.surfaceUniforms);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

// water
{
  const g = new THREE.PlaneGeometry(MAP, MAP);
  g.rotateX(-Math.PI / 2);
  g.translate(MAP / 2, WATER, MAP / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.03, 0.12, 0.15, THREE.SRGBColorSpace), roughness: 0.12, metalness: 0.3 }));
  m.receiveShadow = true;
  scene.add(m);
}

// a few buildings, vehicles and trees
const mats = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.8 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8a3026, roughness: 0.6, metalness: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f4f86, roughness: 0.6, metalness: 0.3 }),
  tree: new THREE.MeshStandardMaterial({ color: 0x2f4a24, roughness: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1.0, 0.75, 0.4), emissiveIntensity: 3 }),
};
for (const m of Object.values(mats)) if (m !== mats.lamp) patchMaterialForWeather(m, weather.surfaceUniforms);
function box(x: number, z: number, w: number, h: number, d: number, mat: THREE.Material, y0 = 0, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, getHeight(x, z) + y0 + h / 2, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function building(x: number, z: number, w: number, h: number, d: number): void {
  box(x, z, w, h, d, mats.concrete);
  box(x, z, w * 0.9, 0.12, d * 0.9, mats.roof, h);
  box(x + w * 0.5 + 0.06, z + d * 0.3, 0.12, 0.12, 0.12, mats.lamp, h * 0.7);
}
function tank(x: number, z: number, mat: THREE.Material, ry: number): void {
  box(x, z, 0.8, 0.22, 0.5, mat, 0.05, ry);
  box(x, z, 0.34, 0.14, 0.3, mat, 0.27, ry);
}
function tree(x: number, z: number, s: number): void {
  const h = getHeight(x, z);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.5 * s, 6), mats.trunk);
  t.position.set(x, h + 0.25 * s, z);
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 1.3 * s, 8), mats.tree);
  c.position.set(x, h + 0.5 * s + 0.6 * s, z);
  t.castShadow = c.castShadow = true;
  c.receiveShadow = true;
  scene.add(t, c);
}
building(52, 46, 3, 1.6, 2.4);
building(56.5, 49, 2.2, 2.4, 2.2);
building(53, 52.5, 4, 1.2, 1.8);
building(44, 54, 2.5, 1.8, 2.5);
building(60, 55, 3, 1.4, 3);
tank(47.5, 49, mats.red, 0.3);
tank(48.6, 50.2, mats.red, 0.1);
tank(45, 47, mats.blue, 2.6);
tank(57, 44, mats.blue, 2.0);
let ts = 991;
const trand = () => ((ts = (ts * 16807) % 2147483647) - 1) / 2147483646;
for (let i = 0; i < 70; i++) {
  const x = 26 + trand() * 46, z = 30 + trand() * 32;
  const h = getHeight(x, z);
  if (h < -0.1 || Math.abs(x - 50) < 2 || (x > 42 && x < 62 && z > 44 && z < 57)) continue;
  tree(x, z, 0.8 + trand() * 0.6);
}

// ---------------------------------------------------------------------------------------------
// post-processing (RenderPass → UnrealBloom(threshold 1.15) → OutputPass, as in the game)

const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
rt.depthTexture.type = THREE.UnsignedIntType;
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), preset.bloom, 0.5, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fog = new THREE.Fog(0x000000, 1000, 2000);
scene.fog = fog;

// ---------------------------------------------------------------------------------------------
// Renderer-side integration example: how the game should consume the weather outputs

const bg = new THREE.Color(preset.bg);
function applyWeatherToScene(): void {
  const w = weather;
  // overcast: dim the sun, grey out the sky light
  sun.intensity = preset.sunIntensity * (1 - 0.72 * w.overcast);
  hemi.color.copy(baseSky).lerp(greySky, w.overcast * 0.45);
  hemi.groundColor.copy(baseGround);
  // lightning: add the flash to the sky light (bluish-white)
  hemi.intensity = preset.hemiIntensity * (1 - 0.25 * w.overcast) + w.flash * 1.6;
  scene.environmentIntensity = preset.env * (1 - 0.3 * w.overcast) + w.flash * 0.2;
  // haze: distance fog starting a bit in front of the focus, thicker with haze
  const hz = w.haze;
  if (hz > 0.005) {
    fog.color.copy(w.hazeColorLit);
    fog.near = dist * (1 - 0.45 * hz);
    fog.far = fog.near + dist / Math.max(0.05, hz);
  } else {
    fog.near = 1000;
    fog.far = 2000;
  }
  (scene.background as THREE.Color).copy(bg).lerp(w.hazeColorLit, Math.min(1, hz));
}

// ---------------------------------------------------------------------------------------------
// simulation

const STEP = 1 / 30;
let simTime = 0;
weather.set(from ?? kind, 0);
let switched = !from;
const firedStrikes = new Set<number>();
const firedClouds = new Set<number>();
function step(dt: number): void {
  simTime += dt;
  if (!switched && simTime >= fadeAt) {
    weather.set(kind, fade);
    switched = true;
  }
  strikes.forEach((s, i) => {
    if (!firedStrikes.has(i) && simTime >= s) { firedStrikes.add(i); weather.strike(spos[0], spos[1]); }
  });
  clouds.forEach((s, i) => {
    if (!firedClouds.has(i) && simTime >= s) { firedClouds.add(i); weather.cloudFlash(0.5); }
  });
  weather.update(dt, simTime, focus.x, focus.y, dist * 0.75);
  applyWeatherToScene();
}

weather.onLightning = (intensity, pos, cloud) => {
  const d = Math.hypot(pos.x - focus.x, pos.z - focus.y);
  console.log(`[lightning] ${cloud ? 'cloud' : 'strike'} i=${intensity.toFixed(2)} at ${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)} thunder in ${(d / 34).toFixed(2)} s`);
};

const hud = document.getElementById('hud')!;
let fps = 0;
function updateHud(): void {
  if (!showHud) { hud.textContent = ''; return; }
  const w = weather;
  const wts = WEATHER_KINDS.filter((k) => w.weights[k] > 0.005).map((k) => `${k} ${(w.weights[k] * 100).toFixed(0)}%`).join(' · ');
  hud.textContent =
    `weather=${w.kind} [${wts}]  tod=${tod}  t=${simTime.toFixed(1)}s  ${fps.toFixed(0)} fps\n` +
    `wetness=${w.wetness.toFixed(2)} snow=${w.snow.toFixed(2)} haze=${w.haze.toFixed(2)} overcast=${w.overcast.toFixed(2)} flash=${w.flash.toFixed(2)} wind=${w.wind.length().toFixed(1)}\n` +
    `weather draw calls=${w.stats.drawCalls} particles=${w.stats.particles} update=${(w.stats.cpuMs * 1000).toFixed(0)}µs  total calls=${renderer.info.render.calls}\n` +
    `keys: 1-6 weather (${WEATHER_KINDS.join(' ')}), L strike, C cloud flash, arrows pan, wheel zoom`;
}

function render(): void {
  renderer.info.reset();
  composer.render();
}

function runBench(): void {
  weather.set('storm', 0);
  for (let i = 0; i < 120; i++) step(STEP);
  const frames = 3000;
  let worst = 0;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    const a = performance.now();
    if (i % 400 === 0) weather.strike();
    focus.x = 48 + Math.sin(i * 0.01) * 6;
    placeCamera();
    step(STEP);
    const d = performance.now() - a;
    if (i > 60 && d > worst) worst = d;
  }
  const avg = (performance.now() - t0) / frames;
  const s0 = performance.now();
  for (let i = 0; i < 200; i++) weather.strike();
  const strikeMs = (performance.now() - s0) / 200;
  const msg = `[bench] Weather.update() at full storm: avg ${(avg * 1000).toFixed(1)} µs/frame, worst ${(worst * 1000).toFixed(0)} µs (incl. strikes, camera moving; timer resolution may be coarse), one lightning strike (bolt generation + upload) ${(strikeMs * 1000).toFixed(0)} µs, draw calls ${weather.stats.drawCalls}, particles ${weather.stats.particles}`;
  console.warn(msg);
  hud.textContent = msg;
  render();
}

addEventListener('keydown', (e) => {
  const i = parseInt(e.key, 10);
  if (i >= 1 && i <= WEATHER_KINDS.length) weather.set(WEATHER_KINDS[i - 1], 6);
  if (e.key === 'l' || e.key === 'L') weather.strike();
  if (e.key === 'c' || e.key === 'C') weather.cloudFlash(0.5);
  const p = dist * 0.04;
  if (e.key === 'ArrowLeft') focus.x -= p;
  if (e.key === 'ArrowRight') focus.x += p;
  if (e.key === 'ArrowUp') focus.y -= p;
  if (e.key === 'ArrowDown') focus.y += p;
  placeCamera();
});
addEventListener('wheel', (e) => {
  dist = Math.min(60, Math.max(10, dist * Math.pow(1.0012, e.deltaY)));
  placeCamera();
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

if (bench) {
  runBench();
} else {
  while (simTime < tTarget - 1e-6) step(STEP);
  applyWeatherToScene();
  updateHud();
  let last = performance.now();
  let frames = 0, acc = 0, hudTick = 0;
  const frame = () => {
    const now = performance.now();
    const real = (now - last) / 1000;
    const dt = Math.min(0.1, real);
    last = now;
    acc += real;
    frames++;
    if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    if (!pause) step(dt);
    render();
    if (++hudTick % 10 === 0) updateHud();
    if (maxFrames > 0 && hudTick >= maxFrames) { updateHud(); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
