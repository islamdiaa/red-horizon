// Worker thread for tools/campaign-levels.ts: plays one mission run per message.
import { parentPort } from 'node:worker_threads';
import { getMission } from '../src/missions';
import { runMission } from './campaigntest';
import type { LevelJob, LevelRun } from './campaign-levels';
import { runKoth, type KothJob, type KothRun } from './campaign-koth';
import { runChallenge, type ChallengeJob, type ChallengeRun } from './campaign-challenges';
import { runConquest, type ConquestJob, type ConquestRun } from './campaign-conquest';
import { setDailyDay } from '../src/missions/special';

parentPort!.on('message', (m: { k: number; job: LevelJob | KothJob }) => {
  if ((m.job as KothJob).kind === 'koth') {
    let kr: KothRun;
    try { kr = runKoth(m.job as KothJob); } catch (e) { kr = { ...(m.job as KothJob), won: false, ended: false, time: 0, byHill: false, held: 0, theirs: 0, error: String(e) }; }
    parentPort!.postMessage({ k: m.k, run: kr });
    return;
  }
  if ((m.job as unknown as ChallengeJob).kind === 'challenge') {
    let cr: ChallengeRun;
    const cj = m.job as unknown as ChallengeJob;
    try { cr = runChallenge(cj); } catch (e) { cr = { ...cj, won: false, time: 0, stars: 0, reason: null, error: String(e) }; }
    parentPort!.postMessage({ k: m.k, run: cr });
    return;
  }
  if ((m.job as unknown as ConquestJob).kind === 'conquest') {
    let cr: ConquestRun;
    const cj = m.job as unknown as ConquestJob;
    try { cr = runConquest(cj); } catch (e) { cr = { ...cj, won: false, ended: false, time: 0, reason: null, ai: '', strength: 0, error: String(e) }; }
    parentPort!.postMessage({ k: m.k, run: cr });
    return;
  }
  const j = m.job as LevelJob;
  setDailyDay(j.day ?? null); // (the daily challenge of that date)
  const t0 = performance.now();
  let run: LevelRun;
  try {
    const r = runMission(getMission(j.mission)!, j.minutes, j.pilot, false, { level: j.level, jitter: j.seed * 7 });
    run = { ...j, won: r.won, ended: r.ended, time: r.time, reason: r.reason, stars: r.stars, objectives: r.objectives, error: r.error, waves: r.waves, score: r.score, ms: performance.now() - t0 };
  } catch (e) {
    run = { ...j, won: false, ended: false, time: 0, reason: null, stars: 0, objectives: [], error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e), ms: performance.now() - t0 };
  }
  parentPort!.postMessage({ k: m.k, run });
});
