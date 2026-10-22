// The built-in challenges (src/modes/builtins.ts) played by the human-like pilots (tools/campaign-players.ts) and,
// as a yardstick, the expert's AI brain (the Hard mission level playing the human's side):
//   node --import tsx tools/campaign-challenges.ts [--pilots newcomer,casual,expert] [--seeds 6]
// Seeds perturb the simulation RNG. Prints wins / runs per challenge and pilot.
import { availableParallelism } from 'node:os';
import { headlessGame } from '../src/modes/headless';
import { challengeGameSetup } from '../src/modes/author';
import { challengeResult } from '../src/modes/challenge';
import { BUILTIN_LIST } from '../src/modes/builtins';
import { TICK_HZ } from '../src/sim/types';
import { skillPilot } from './campaign-players';
import { genericPilot } from './campaign-pilots';

export interface ChallengeJob { kind: 'challenge'; id: string; pilot: string; seed: number }
export interface ChallengeRun extends ChallengeJob { won: boolean; time: number; stars: number; reason: string | null; error?: string }

export function runChallenge(j: ChallengeJob): ChallengeRun {
  const def = BUILTIN_LIST.find((c) => c.id === j.id)!;
  const g = headlessGame(challengeGameSetup(def, 'low'));
  const w = g.world, rt = w.mission!;
  for (let k = 0; k < j.seed * 7; k++) w.rng.next();
  const pilot = j.pilot === 'expert' ? genericPilot : skillPilot(j.pilot as 'newcomer' | 'casual');
  const s: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    for (let t = 0; t < (def.timeLimit + 60) * TICK_HZ && !w.gameOver; t++) {
      w.step();
      if (t % 10 === 0) pilot(w, rt, s, () => {});
      w.events.length = 0;
      rt.events.length = 0;
    }
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }
  const res = challengeResult(rt);
  return { ...j, won: !!res?.won, time: w.time, stars: res?.stars ?? 0, reason: res?.reason ?? null, error };
}

if (process.argv[1]?.endsWith('campaign-challenges.ts')) {
  const { runAll } = await import('./campaign-levels');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const pilots = arg('pilots', 'newcomer,casual,expert').split(',');
  const seeds = +arg('seeds', '6');
  const jobs: ChallengeJob[] = [];
  for (const c of BUILTIN_LIST) for (const pilot of pilots) for (let seed = 0; seed < seeds; seed++) jobs.push({ kind: 'challenge', id: c.id, pilot, seed });
  const workers = +(process.env.WORKERS ?? 0) || Math.max(1, Math.min(6, availableParallelism() - 4));
  const runs = (await runAll(jobs as never[], workers, () => {})) as unknown as ChallengeRun[];
  console.log(`| challenge | AI | ${pilots.join(' | ')} |\n|---|---|${pilots.map(() => '---').join('|')}|`);
  for (const c of BUILTIN_LIST) {
    console.log(`| ${c.id} | ${c.ai} | ${pilots.map((p) => { const rs = runs.filter((r) => r.id === c.id && r.pilot === p); return `${rs.filter((r) => r.won).length}/${rs.length}`; }).join(' | ')} |`);
  }
  for (const r of runs) if (r.error) console.error('ERROR', r.id, r.pilot, r.seed, r.error.split('\n')[0]);
}
