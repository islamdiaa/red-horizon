import { generateMap } from './sim/mapgen';
import { GameRenderer } from './render/renderer';
const q = new URLSearchParams(location.search);
const seed = +(q.get('seed') ?? 1234);
const map = generateMap({ size: 96, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
const r = new GameRenderer(document.getElementById('c') as HTMLCanvasElement, map, { quality: (q.get('q') as any) ?? 'high', timeOfDay: (q.get('tod') as any) ?? 'day' });
r.fog.enabled = q.get('fog') === '1';
const x = +(q.get('x') ?? map.startPositions[0].x), y = +(q.get('y') ?? map.startPositions[0].y);
r.cam.jumpTo(x, y);
r.cam.dist = r.cam.targetDist = +(q.get('d') ?? 28);
// reveal everything for the test
const fake: any = { visible: new Uint16Array(map.w * map.h).fill(1), explored: new Uint8Array(map.w * map.h).fill(1) };
if (q.get('fog') === '1') { fake.visible.fill(0); fake.explored.fill(0); for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) { const d = Math.hypot(i - x, j - y); if (d < 14) fake.explored[j * map.w + i] = 1; if (d < 9) fake.visible[j * map.w + i] = 1; } }
r.fog.snap(fake);
let t = 0, last = performance.now();
function loop(now: number) { const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt; r.fog.update(fake, dt); r.render(dt, t); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
(window as any).ready = true;
