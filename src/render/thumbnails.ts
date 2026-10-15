import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BUILDINGS, UNITS } from '../data/rules';
import { createModel } from './models';
import { WallRenderer } from './walls';

interface ThumbStage { renderer: THREE.WebGLRenderer; scene: THREE.Scene; canvas: HTMLCanvasElement }
let stage: ThumbStage | null = null;

/** One long-lived offscreen renderer for portraits (a fresh one per game would leak its GL context). */
function getStage(w: number, h: number): ThumbStage {
  if (!stage || stage.renderer.getContext().isContextLost()) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.environmentIntensity = 0.45;
    scene.add(new THREE.HemisphereLight(0xc8dcff, 0x40342a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0dd, 3.0);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88b8ff, 1.4);
    rim.position.set(-4, 3, -5);
    scene.add(rim);
    stage = { renderer, scene, canvas };
  }
  if (stage.canvas.width !== w || stage.canvas.height !== h) stage.renderer.setSize(w, h, false);
  return stage;
}

/** Renders sidebar portraits of the real 3D models (once per type), returning data URLs. */
export function renderThumbnails(ids: string[], teamColor: number, w = 168, h = 128): Map<string, string> {
  const out = new Map<string, string>();
  const { renderer, scene, canvas } = getStage(w, h);
  // baked per call: game teardown releases every GPU resource (see gpuregistry), render targets included
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.05, 100);
  const color = new THREE.Color(teamColor);
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  for (const id of ids) {
    try {
      const m = BUILDINGS[id]?.wall
        ? (() => { const root = WallRenderer.preview(id); root.rotation.y = 0.5; return { root, update() {}, dispose() { root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); } } as unknown as ReturnType<typeof createModel>; })()
        : createModel(id, color);
      const isBld = id in BUILDINGS;
      const unit = UNITS[id];
      if (!isBld) m.root.rotation.y = -Math.PI * 0.18 - Math.PI / 2 + Math.PI; // face the viewer, three-quarter
      if (unit?.kind === 'aircraft') m.root.position.y = 0.2;
      m.update({ time: 0.3, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0.6, harvesting: false, charge: 1, dying: 0, altitude: 0.2 });
      scene.add(m.root);
      m.root.updateMatrixWorld(true);
      box.setFromObject(m.root);
      box.getSize(size);
      box.getCenter(center);
      const radius = Math.max(size.x, size.y * 1.2, size.z) * 0.62 + 0.02;
      const dist = radius / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (isBld ? 1.05 : 1.15);
      const dir = new THREE.Vector3(0.55, 0.62, 1).normalize();
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.lookAt(center.x, center.y - size.y * 0.05, center.z);
      renderer.render(scene, cam);
      out.set(id, canvas.toDataURL('image/png'));
      scene.remove(m.root);
      m.dispose();
    } catch (e) {
      console.warn('thumbnail failed', id, e);
    }
  }
  scene.environment = null;
  env.dispose();
  pmrem.dispose();
  return out;
}
