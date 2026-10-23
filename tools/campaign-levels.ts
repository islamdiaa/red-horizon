// Every mission at every campaign difficulty, played by pilots of three skills (tools/campaign-players.ts):
//   node --import tsx tools/campaign-levels.ts [--missions all|allies|soviet|special|<id,id>] [--levels recruit,easy,normal,hard,brutal]
//        [--pilots newcomer,casual,expert] [--seeds 6] [--minutes 45] [--out file.json] [--table]
//        [--days 2026-10-01:30]   (with --missions daily: that many daily challenges from that date, one seed each)
// Seeds perturb the simulation RNG (as JITTER does in campaigntest.ts). WORKERS=n caps the worker threads.
// Prints one row per mission x level: wins / runs for each pilot, and writes every run to --out (JSON).
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { campaignMissions, getMission } from '../src/missions';
import { MISSION_LEVELS, type MissionLevel } from '../src/sim/handicap';

export interface LevelJob { mission: string; level: MissionLevel; pilot: string; seed: number; minutes: number; /** daily challenge date (YYYY-MM-DD) */ day?: string }
export interface LevelRun extends LevelJob { won: boolean; ended: boolean; time: number; reason: string | null; stars: number; objectives: string[]; error?: string; waves?: number; score?: number; ms: number }

const LEVELED = ['allies', 'soviet'] as const;
const SPECIAL_LEVELED = ['wolfpack', 'ironcoast'];

function missionIds(arg: string): string[] {
  if (arg === 'all') return [...LEVELED.flatMap((c) => campaignMissions(c).map((m) => m.id)), ...SPECIAL_LEVELED];
  if (arg === 'allies' || arg === 'soviet') return campaignMissions(arg).map((m) => m.id);
  if (arg === 'special') return SPECIAL_LEVELED;
  // co-op survival: each variant solo, then with one and two allies at the allies' Normal, Hard and Brutal
  if (arg === 'coop' || arg === 'survival') {
    const variants = ['survival', 'survival-winter', 'survival-desert'];
    return variants.flatMap((v) => [v, ...['normal', 'hard', 'brutal'].flatMap((d) => [`${v}:coop:${d}`, `${v}:coop:${d}+${d}`])]);
  }
  return arg.split(',');
}

/** Run jobs on worker threads (mission runs; tools/campaign-koth.ts sends King of the Hill games through the same pool). */
export async function runAll(jobs: LevelJob[], workers: number, progress: (done: number, r: LevelRun) => void): Promise<LevelRun[]> {
  const out: LevelRun[] = new Array(jobs.length);
  let next = 0, done = 0;
  const pool: Worker[] = [];
  await new Promise<void>((resolve, reject) => {
    if (!jobs.length) { resolve(); return; }
    const feed = (w: Worker) => {
      if (next >= jobs.length) { void w.terminate(); return; }
      const k = next++;
      w.postMessage({ k, job: jobs[k] });
    };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const w = new Worker(new URL('./campaign-levels-boot.mjs', import.meta.url));
      pool.push(w);
      w.on('message', (m: { k: number; run: LevelRun }) => {
        out[m.k] = m.run;
        done++;
        progress(done, m.run);
        if (done === jobs.length) resolve(); else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  for (const w of pool) void w.terminate();
  return out;
}

/** wins/runs per (mission, level, pilot). */
export function tabulate(runs: LevelRun[], pilots: string[]): string {
  const key = (r: LevelRun) => `${r.mission}|${r.level}`;
  const rows = new Map<string, Map<string, { w: number; n: number; t: number[]; waves: number[] }>>();
  for (const r of runs) {
    const row = rows.get(key(r)) ?? new Map();
    rows.set(key(r), row);
    const c = row.get(r.pilot) ?? { w: 0, n: 0, t: [], waves: [] };
    c.n++;
    if (r.waves !== undefined) c.waves.push(r.waves);
    if (r.won) { c.w++; c.t.push(r.time); }
    row.set(r.pilot, c);
  }
  const lines = [`| mission | level | ${pilots.join(' | ')} |`, `|---|---|${pilots.map(() => '---').join('|')}|`];
  for (const [k, row] of rows) {
    const [m, l] = k.split('|');
    lines.push(`| ${m} | ${l} | ${pilots.map((p) => {
      const c = row.get(p);
      if (!c) return '';
      if (c.waves.length) {
        // scored (survival): median waves survived [min-max]
        const ws = c.waves.sort((a, b) => a - b);
        return `${ws[ws.length >> 1]} waves [${ws[0]}–${ws[ws.length - 1]}]`;
      }
      const med = c.t.length ? c.t.sort((a, b) => a - b)[c.t.length >> 1] : 0;
      return `${c.w}/${c.n}${c.t.length ? ` (${Math.floor(med / 60)}:${String(Math.round(med % 60)).padStart(2, '0')})` : ''}`;
    }).join(' | ')} |`);
  }
  return lines.join('\n');
}

if (isMainThread && process.argv[1]?.endsWith('campaign-levels.ts')) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const missions = missionIds(arg('missions', 'all'));
  const levels = arg('levels', MISSION_LEVELS.join(',')).split(',') as MissionLevel[];
  const pilots = arg('pilots', 'newcomer,casual,expert').split(',');
  const seeds = +arg('seeds', '6');
  const minutes = +arg('minutes', '45');
  const outFile = arg('out', '');
  const workers = +(process.env.WORKERS ?? 0) || Math.max(1, Math.min(6, availableParallelism() - 4));
  const jobs: LevelJob[] = [];
  const daysArg = arg('days', '');
  for (const mission of missions) {
    if (!getMission(mission)) { console.error('unknown mission', mission); process.exit(1); }
    if (mission === 'daily' && daysArg) {
      const [from, n] = daysArg.split(':');
      const t = Date.parse(from + 'T00:00:00Z');
      for (let k = 0; k < +(n ?? 1); k++) {
        const day = new Date(t + k * 86400000).toISOString().slice(0, 10);
        for (const pilot of pilots) jobs.push({ mission: `daily`, level: 'normal', pilot, seed: 0, minutes, day });
      }
      continue;
    }
    for (const level of levels) for (const pilot of pilots) for (let seed = 0; seed < seeds; seed++) jobs.push({ mission, level, pilot, seed, minutes });
  }
  const t0 = Date.now();
  console.error(`${jobs.length} runs on ${workers} workers`);
  const runs = await runAll(jobs, workers, (done, r) => {
    if (r.error) console.error(`ERROR ${r.mission} ${r.level} ${r.pilot} #${r.seed}: ${r.error.split('\n')[0]}`);
    if (done % 25 === 0 || done === jobs.length) console.error(`  ${done}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  });
  if (outFile) writeFileSync(outFile, JSON.stringify(runs));
  const days = runs.filter((r) => r.day);
  if (days.length) {
    // daily challenges: one row per date (result, time, score per pilot)
    console.log(`| day | ${pilots.join(' | ')} |\n|---|${pilots.map(() => '---').join('|')}|`);
    for (const day of [...new Set(days.map((r) => r.day))]) {
      console.log(`| ${day} | ${pilots.map((p) => { const r = days.find((x) => x.day === day && x.pilot === p); return r ? `${r.error ? 'ERROR' : r.won ? 'won' : r.ended ? 'lost' : 'open'} ${Math.round(r.time / 60)}m ${r.score ?? 0}` : ''; }).join(' | ')} |`);
    }
  }
  const rest = runs.filter((r) => !r.day);
  if (rest.length) console.log(tabulate(rest, pilots));
}
