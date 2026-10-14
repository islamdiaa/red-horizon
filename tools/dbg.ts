import { generateMap } from '../src/sim/mapgen';
import { World } from '../src/sim/world';
const map = generateMap({ size: 96, players: 2, seed: 777, water: 0.5, trees: 0.5, ore: 0.6 });
const world = new World({ map, players: [
  { name: 'P0', faction: 'allies', color: 0, team: 0, isHuman: false, ai: 'hard' },
  { name: 'P1', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'hard' }], credits: 5000, startUnits: 'mcv', fog: true, seed: 777 });
const ai: any = world.ais[0];
let lastState = 'build';
console.log('starts', map.startPositions);
for (let t = 1; t <= 20 * 60 * 16; t++) {
  world.step(); world.events.length = 0;
  if (ai.state !== lastState) { console.log((world.time/60).toFixed(2), 'AI0 state ->', ai.state, 'wave', ai.wave.size); lastState = ai.state; }
  if (ai.state === 'attack' && t % 200 === 0) {
    const ws = [...ai.wave].map((id: number) => world.entities.get(id)).filter((u: any) => u && u.alive);
    const desc = ws.slice(0, 6).map((u: any) => `${u.ut.id}@${u.x.toFixed(0)},${u.y.toFixed(0)}:${u.order.type}${u.path ? 'P' : ''}${u.target ? 'T' : ''}`).join(' ');
    console.log((world.time/60).toFixed(2), 'wave alive', ws.length, desc);
  }
}
