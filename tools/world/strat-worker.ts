// Worker for tools/world/strat-*.ts: plays the games it is sent (tools/world/strat-lib.ts playGame).
// WORLD_AI_TUNE (JSON, experiments only): {"level": {"normal": {...}}, "base": {"holder": {...}}, "sets": [4, 6, ...], "zoneScale": 1.5}
// patches the rivals' tables (src/conquest/world/powers.ts AI_LEVEL / AI_BASE) and the card set values in this thread.
import { parentPort } from 'node:worker_threads';
import { playGame, type PlayOptions } from './strat-lib';
import { AI_BASE, AI_LEVEL } from '../../src/conquest/world/powers';
import { SET_VALUES } from '../../src/conquest/world/rules';
import type { NewWorldOptions } from '../../src/conquest/world/run';
import { MAP_TUNE } from '../../src/conquest/world/atlas';

const tune = process.env.WORLD_AI_TUNE ? JSON.parse(process.env.WORLD_AI_TUNE) : null;
if (tune) {
  for (const [k, v] of Object.entries(tune.level ?? {})) Object.assign((AI_LEVEL as Record<string, object>)[k], v);
  for (const [k, v] of Object.entries(tune.base ?? {})) Object.assign((AI_BASE as Record<string, object>)[k], v);
  if (Array.isArray(tune.sets)) SET_VALUES.splice(0, SET_VALUES.length, ...tune.sets);
  if (typeof tune.zoneScale === 'number') MAP_TUNE.zoneScale = tune.zoneScale;
}

parentPort!.on('message', (m: { k: number; opts: NewWorldOptions; play: PlayOptions }) => {
  parentPort!.postMessage({ k: m.k, res: playGame(m.opts, m.play) });
});
