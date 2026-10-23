// Conquest battles of every kind at each run difficulty, played by the human-like pilots (tools/campaign-players.ts)
// and the strike-force autopilot of tools/conquest-harness.ts ('auto', which gets a head start):
//   node --import tsx tools/campaign-conquest.ts [--difficulties easy,normal,hard] [--pilots newcomer,casual,auto] [--seeds 4]
//        [--battles naval,boss] [--out file.json]
// Seeds are run seeds (each gives other territories, commanders and maps); both factions are played.
import { availableParallelism } from 'node:os';
import { BATTLE_KINDS, type BattleKind } from '../src/conquest/battle';
import { runWithBattle } from '../src/conquest/testing';
import { runConquestBattle } from './conquest-harness';

export interface ConquestJob { kind: 'conquest'; battle: BattleKind; seed: number; faction: 'allies' | 'soviet'; pilot: 'auto' | 'newcomer' | 'casual'; difficulty: 'easy' | 'normal' | 'hard' }
export interface ConquestRun extends ConquestJob { won: boolean; ended: boolean; time: number; reason: string | null; ai: string; strength: number; error?: string }

export function runConquest(j: ConquestJob): ConquestRun {
  const { setup } = runWithBattle(j.seed, j.faction, j.battle, 'vanguard', j.difficulty);
  const r = runConquestBattle(setup, 30, j.pilot);
  return { ...j, won: r.won, ended: r.ended, time: r.time, reason: r.reason, ai: setup.battle.ai, strength: setup.battle.strength, error: r.error };
}

if (process.argv[1]?.endsWith('campaign-conquest.ts')) {
  const { runAll } = await import('./campaign-levels');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const difficulties = arg('difficulties', 'easy,normal,hard').split(',') as ConquestJob['difficulty'][];
  const pilots = arg('pilots', 'newcomer,casual,auto').split(',') as ConquestJob['pilot'][];
  const seeds = +arg('seeds', '4');
  const kinds = arg('battles', BATTLE_KINDS.join(',')).split(',') as BattleKind[];
  const jobs: ConquestJob[] = [];
  for (const difficulty of difficulties) for (const pilot of pilots) for (const battle of kinds) for (let s = 0; s < seeds; s++) for (const faction of ['allies', 'soviet'] as const) {
    jobs.push({ kind: 'conquest', battle, seed: 7 + s * 4, faction, pilot, difficulty });
  }
  const workers = +(process.env.WORKERS ?? 0) || Math.max(1, Math.min(6, availableParallelism() - 4));
  const runs = (await runAll(jobs as never[], workers, () => {})) as unknown as ConquestRun[];
  const out = arg('out', '');
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(runs));
  console.log(`| run difficulty | battle | ${pilots.join(' | ')} |\n|---|---|${pilots.map(() => '---').join('|')}|`);
  for (const d of difficulties) for (const b of kinds) {
    console.log(`| ${d} | ${b} | ${pilots.map((p) => { const rs = runs.filter((r) => r.difficulty === d && r.battle === b && r.pilot === p); return `${rs.filter((r) => r.won).length}/${rs.length}`; }).join(' | ')} |`);
  }
  for (const r of runs) if (r.error) console.error('ERROR', r.battle, r.pilot, r.seed, r.error.split('\n')[0]);
}
