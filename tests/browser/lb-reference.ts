// Reference world hashes for tests/browser/leaderboard.mjs: today's Daily Challenge and Survival after N ticks
// without orders, computed by the Node engine (as the leaderboard server runs it).
import { headlessGame } from '../../src/modes/headless';
import { boardSetup } from '../../src/net/boards';
import { worldHash } from '../../src/replay/hash';
import { enterPortableMath } from '../../src/net/dmath';

enterPortableMath(); // ranked boards run with portable math, in the game and on the server

const ticks = 600;
const out: Record<string, string | number> = { ticks };
for (const id of ['daily', 'survival']) {
  const g = headlessGame(boardSetup(id === 'daily' ? 'daily' : 'survival', id)!);
  const w = g.world;
  while (w.tick < ticks) { w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; }
  out[id] = worldHash(w);
}
console.log(JSON.stringify(out));
