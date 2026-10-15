// Headless mission harness: node --import tsx tools/missiontest.ts <missionId> [minutes]
// The human side is driven by an AI autopilot (base building) plus periodic attack-moves.
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { MissionRuntime } from '../src/sim/mission';
import { AIController } from '../src/sim/ai';
import { getMission } from '../src/missions';
import { TICK_HZ } from '../src/sim/types';

const id = process.argv[2] ?? 'allied-01';
const minutes = +(process.argv[3] ?? 25);
const def = getMission(id)!;
const mp = def.map;
const map = generateMap({ size: mp.size, players: mp.players, seed: mp.seed, water: mp.water ?? 0.5, trees: mp.trees ?? 0.5, ore: mp.ore ?? 0.6 });
const players: PlayerSetup[] = def.players.map((ps, i) => ({ name: ps.name, faction: ps.faction, color: 0, team: ps.team ?? i, isHuman: i === 0, ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai }));
const world = new World({ map, players, credits: def.credits ?? 5000, startUnits: 'none', startUnitsPer: def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')), creditsPer: def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)), fog: true, seed: mp.seed });
const rt = new MissionRuntime(world, def);
world.mission = rt;
def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
def.setup(rt);
const pilot = new AIController(world, world.players[0], 'hard');
world.ais.push(pilot);
const log = (s: string) => console.log(`[${(world.time / 60).toFixed(2)}m] ${s}`);
for (let t = 0; t < minutes * 60 * TICK_HZ && !world.gameOver; t++) {
  world.step();
  if (t % (TICK_HZ * 40) === 0 && t > TICK_HZ * 60) {
    // push the human army at the nearest enemy thing
    const enemy = world.units.find((u) => u.alive && u.owner.team !== 0) ?? world.buildings.find((b) => b.alive && b.owner.team !== 0 && !b.bt.wall);
    const army = world.units.filter((u) => u.alive && u.owner.id === 0 && u.weapons.length && !u.ut.harvester);
    if (enemy && army.length) world.issue({ c: 'move', player: 0, units: army.map((u) => u.id), x: enemy.x, y: enemy.y, attackMove: true });
  }
  for (const ev of rt.events) {
    if (ev.e === 'objective') log(`objective ${ev.change}: ${ev.objective.text} ${ev.objective.progress ?? ''}`);
    else if (ev.e === 'message') log(`radio ${ev.speaker}: ${ev.text.slice(0, 70)}`);
    else if (ev.e === 'end') log(`END won=${ev.won} ${ev.reason ?? ''}`);
    else if (ev.e === 'timer' && ev.label) log(`timer ${ev.label} ${ev.seconds}`);
  }
  rt.events.length = 0;
  world.events.length = 0;
}
console.log('result', { gameOver: world.gameOver, won: rt.won, time: (world.time / 60).toFixed(1) + 'm', score: rt.score, objectives: rt.objectives.map((o) => `${o.id}:${o.state}`) });
