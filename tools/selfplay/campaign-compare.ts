/**
 * Campaign check for AI changes: every campaign mission played by its autopilot (tools/campaign-pilots*.ts) with the
 * current AI and with the frozen round-4 AI (tools/selfplay/legacy), over several RNG jitters, so a changed result
 * can be told apart from chance (one run per mission is a single roll of the dice).
 *
 *   node --import tsx tools/selfplay/campaign-compare.ts [jitters=4] [missions=all|allies|soviet|<id>] [minutes=40]
 */
import { campaignMissions, getMission } from '../../src/missions';
import { TICK_HZ } from '../../src/sim/types';
import type { MissionDef } from '../../src/sim/mission';
import type { World } from '../../src/sim/world';
import { createMissionWorld } from '../campaigntest';
import { PILOTS, genericPilot } from '../campaign-pilots';
import '../campaign-pilots-allied';
import '../campaign-pilots-soviet';
import '../campaign-pilots-special';
import { LegacyAIController } from './legacy/ai';

const jitters = +(process.argv[2] ?? 4);
const which = process.argv[3] ?? 'all';
const minutes = +(process.argv[4] ?? 40);

/** Swap every AI of the world for the legacy controller (same difficulty / behaviour). */
function legacyize(world: World) {
  world.ais = world.ais.map((ai) => swap(world, ai)) as any;
}

function swap(world: World, ai: any): any {
  if (ai instanceof LegacyAIController) return ai;
  const l = new LegacyAIController(world, ai.player, ai.difficulty) as any;
  if (ai.behaviour !== 'full') l.setMode(ai.behaviour);
  return l;
}

/** The pilots create their brain / placer lazily: swap those for legacy ones right after they appear. */
function swapPilotAIs(world: World, state: Record<string, any>) {
  for (const k of ['brain', 'placer']) {
    const ai = state[k];
    if (!ai || ai instanceof LegacyAIController) continue;
    const l = swap(world, ai);
    state[k] = l;
    const i = world.ais.indexOf(ai);
    if (i >= 0) world.ais[i] = l;
  }
}

function run(def: MissionDef, legacy: boolean, jitter: number): { won: boolean; ended: boolean; time: number } {
  process.env.JITTER = String(jitter);
  const { world, rt } = createMissionWorld(def);
  const state: Record<string, any> = {};
  if (legacy) legacyize(world);
  const pilot = PILOTS[def.id] ?? genericPilot;
  const maxTicks = minutes * 60 * TICK_HZ;
  for (let t = 0; t < maxTicks && !world.gameOver; t++) {
    world.step();
    if (t % 10 === 0) {
      pilot(world, rt, state, () => {});
      if (legacy) swapPilotAIs(world, state);
    }
    rt.events.length = 0;
    world.events.length = 0;
  }
  return { won: rt.won, ended: rt.ended, time: world.time };
}

const defs = which === 'all' ? [...campaignMissions('allies'), ...campaignMissions('soviet')]
  : which === 'allies' || which === 'soviet' ? campaignMissions(which) : [getMission(which)!];
console.log(`mission      current AI (wins / ${jitters}, mean min)   legacy AI`);
for (const def of defs) {
  const res = [false, true].map((legacy) => {
    let wins = 0, t = 0;
    for (let j = 0; j < jitters; j++) {
      const r = run(def, legacy, j);
      if (r.won) wins++;
      t += r.time;
    }
    return `${wins}/${jitters}  ${(t / jitters / 60).toFixed(1)}`;
  });
  console.log(`${def.id.padEnd(12)} ${res[0].padEnd(28)} ${res[1]}`);
}
