// Lose-condition checks: kill a mission-critical entity and verify the mission fails with a clear reason.
//   node --import tsx tools/campaign-losetest.ts
import { createMissionWorld } from './campaigntest';
import { getMission } from '../src/missions';
import { TICK_HZ } from '../src/sim/types';
import type { MissionRuntime } from '../src/sim/mission';

type Case = { id: string; at: number; what: string; kill: (rt: MissionRuntime) => void };
const byFlag = (key: string) => (rt: MissionRuntime) => { const e = rt.world.getEntity(rt.flags[key]); if (e) rt.world.kill(e); };
const cases: Case[] = [
  { id: 'allied-02', at: 20, what: 'rail yard', kill: byFlag('yard') },
  { id: 'allied-03', at: 20, what: 'Kestrel', kill: byFlag('kestrel') },
  { id: 'allied-03', at: 20, what: 'both engineers', kill: (rt) => { for (const id of rt.flags.engineers) { const e = rt.world.getEntity(id); if (e) rt.world.kill(e); } } },
  { id: 'allied-04', at: 20, what: 'Dr. Saarinen', kill: byFlag('saarinen') },
  { id: 'allied-06', at: 20, what: 'nothing (launch timer)', kill: (rt) => { rt.flags.left = 3; } },
  { id: 'soviet-03', at: 20, what: 'both engineers', kill: (rt) => { for (const id of rt.flags.engineers) { const e = rt.world.getEntity(id); if (e) rt.world.kill(e); } } },
  { id: 'soviet-04', at: 20, what: 'MCV', kill: byFlag('mcv') },
  { id: 'soviet-05', at: 20, what: 'Chronosphere', kill: byFlag('pdox') },
  { id: 'soviet-06', at: 20, what: 'Iron Curtain', kill: byFlag('iron') },
  { id: 'allied-05', at: 20, what: 'nothing (reserve timer)', kill: (rt) => { rt.setTimeLeft('reserve', 1); } },
  { id: 'soviet-01', at: 20, what: 'the heavy tanks and the V2', kill: (rt) => { for (const u of rt.units(0, ['3tnk', 'v2rl'])) rt.world.kill(u); } },
];
let fail = 0;
for (const c of cases) {
  const { world, rt } = createMissionWorld(getMission(c.id)!);
  let done = false;
  for (let t = 0; t < 60 * TICK_HZ && !world.gameOver; t++) {
    world.step();
    if (!done && world.time >= c.at) { c.kill(rt); done = true; }
    rt.events.length = 0; world.events.length = 0;
  }
  const ok = rt.ended && !rt.won && !!rt.endReason;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.id.padEnd(10)} kill ${c.what.padEnd(24)} -> ${rt.ended ? (rt.won ? 'WON?!' : 'lost: ' + rt.endReason) : 'still running'} at ${world.time.toFixed(0)}s`);
}
process.exit(fail ? 1 : 0);
