/** Worker thread: re-simulate one leaderboard run (src/net/verify.ts) and post the result. */
import { parentPort, workerData } from 'node:worker_threads';
import { verifyRun } from '../../../src/net/verify';
import type { Submission } from '../../../src/net/boards';

const { sub, maxTicks, deadline } = workerData as { sub: Submission; maxTicks: number; deadline: number };
let res;
try {
  res = verifyRun(sub, { maxTicks, expired: () => Date.now() > deadline });
} catch {
  res = { ok: false, reason: 'The run could not be simulated.' };
}
parentPort!.postMessage(res);
