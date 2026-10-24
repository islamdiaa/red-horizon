// World Conquest QA: determinism of the strategic layer (round 6 contract: "A world run replays identically from its
// seed and choices. Save and load at any turn gives the same continuation").
//
// For each case (homeland, size, difficulty, seed) the random policy of qa-fuzz.ts plays a whole run three times:
//   A  straight through, hashing the run's JSON at the start of every turn and at the end;
//   B  the same seed and the same choices again: every hash must match A (no hidden state, no Math.random / Date);
//   C  the same, but the run goes through the save path (storage.ts saveWorldRun -> loadWorldRun, a fresh object,
//      fresh index caches) at the start of every turn and after every 7th action mid-turn: every hash must match A.
//
//   node --import tsx tools/world/qa-determinism.ts [--cases 60] [--seed0 1] [--out file.md]   (WORKERS=n, default 6)
import { QA_OUT } from './qa-pool'; // (results default to screenshots/world-qa/ in the repo: git-ignored)
import { Rng } from '../../src/core/rng';
import type { WorldRun } from '../../src/conquest/world/state';
import { api, policyStep, type FuzzJob, type StepStats } from './qa-fuzz';

/** FNV-1a over the run's JSON (the whole document: what a save stores). */
export function runHash(run: WorldRun): string {
  const s = JSON.stringify(run);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

export interface DetJob extends FuzzJob { saveEvery?: number }
export interface DetResult { job: DetJob; turns: number; status: string; hashes: number; sameAgain: boolean; sameAfterLoads: boolean; loads: number; firstDiff: string | null; error: string | null; ms: number }

async function play(job: DetJob, mode: 'A' | 'C'): Promise<{ hashes: string[]; run: WorldRun; loads: number }> {
  const W = await api();
  const S = await import('../../src/conquest/world/storage');
  const rng = new Rng(job.policy * 2654435761 + 17);
  const stats: StepStats = { battles: 0, dice: 0, blitz: 0, ceasefires: 0, trades: 0 };
  let run = W.newWorldRun({ seed: job.seed, home: job.home, size: job.size, difficulty: job.difficulty as never });
  // (QA_FRESH=1: start every mode from the run's JSON, i.e. fresh index caches, to look past STRAT-1)
  if (process.env.QA_FRESH) run = JSON.parse(JSON.stringify(run));
  const hashes: string[] = [];
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  let loads = 0, lastTurn = -1, steps = 0;
  const reload = () => {
    if (!S.saveWorldRun(run, kv as never)) throw new Error(`saveWorldRun failed at turn ${run.turn}`);
    const back = S.loadWorldRun(kv as never);
    if (!back) throw new Error(`loadWorldRun gave nothing at turn ${run.turn} (phase ${run.phase})`);
    run = back;
    loads++;
  };
  while (run.status === 'active' && steps < 400_000) {
    if (run.turn !== lastTurn) {
      lastTurn = run.turn;
      if (mode === 'C') reload();
      hashes.push(`t${run.turn}:${runHash(run)}`);
    } else if (mode === 'C' && steps % (job.saveEvery ?? 7) === 0) reload();
    steps++;
    const st = policyStep(W, run, rng, job, stats);
    if (st.softlock) throw new Error(st.softlock);
  }
  hashes.push(`end:${runHash(run)}`);
  return { hashes, run, loads };
}

export async function detOne(job: DetJob): Promise<DetResult> {
  const t0 = performance.now();
  const r: DetResult = { job, turns: 0, status: 'error', hashes: 0, sameAgain: false, sameAfterLoads: false, loads: 0, firstDiff: null, error: null, ms: 0 };
  try {
    const a = await play(job, 'A');
    const b = await play(job, 'A');
    const c = await play(job, 'C');
    r.turns = a.run.turn; r.status = a.run.status; r.hashes = a.hashes.length; r.loads = c.loads;
    const diff = (x: string[], y: string[]) => { for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `#${i}: ${x[i]} vs ${y[i]}`; return null; };
    const dAB = diff(a.hashes, b.hashes), dAC = diff(a.hashes, c.hashes);
    r.sameAgain = !dAB; r.sameAfterLoads = !dAC;
    r.firstDiff = dAB ? `replay ${dAB}` : dAC ? `after loads ${dAC}` : null;
  } catch (e) {
    r.error = e instanceof Error ? `${e.message} | ${(e.stack ?? '').split('\n').slice(1, 3).join(' | ')}` : String(e);
  }
  r.ms = Math.round(performance.now() - t0);
  return r;
}

if (process.argv[1]?.endsWith('qa-determinism.ts')) {
  const { runPool } = await import('./qa-pool');
  const fs = await import('node:fs');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const W = await api();
  const { WORLD_DIFFICULTIES } = await import('../../src/conquest/world/state');
  const { worldHomelandIds } = await import('./qa-fuzz');
  const homes = worldHomelandIds(W);
  const n = +arg('cases', '60'), seed0 = +arg('seed0', '1');
  const jobs: DetJob[] = [];
  for (let i = 0; i < n; i++) {
    jobs.push({ home: homes[(i * 7) % homes.length], size: i % 3 === 0 ? 'world' : 'blitz', difficulty: WORLD_DIFFICULTIES[i % WORLD_DIFFICULTIES.length], seed: seed0 + i * 104729, policy: seed0 + i * 31, fight: 0.1, saveEvery: 3 + (i % 9) });
  }
  const t0 = Date.now();
  const outs = await runPool<DetJob, DetResult>('./qa-determinism.ts', 'detOne', jobs, { progress: (d, t, o) => { if (!o.ok || o.value.error || o.value.firstDiff) console.log(`BAD ${o.ok ? `${o.value.job.home} ${o.value.job.size} ${o.value.job.difficulty} seed ${o.value.job.seed}: ${o.value.error ?? o.value.firstDiff}` : o.error.split('\n')[0]}`); if (d % 10 === 0 || d === t) console.log(`${d}/${t}`); } });
  const rs = outs.map((o) => (o.ok ? o.value : null)).filter(Boolean) as DetResult[];
  const ok = rs.filter((r) => !r.error && r.sameAgain && r.sameAfterLoads);
  const lines = [
    `# World determinism, seed0 ${seed0}: ${ok.length}/${jobs.length} identical (${Math.round((Date.now() - t0) / 1000)} s)`, '',
    `replays identical: ${rs.filter((r) => r.sameAgain).length}/${jobs.length}; save/load at every turn (+ every 3-11 actions) identical: ${rs.filter((r) => r.sameAfterLoads).length}/${jobs.length}; errors ${rs.filter((r) => r.error).length + jobs.length - rs.length}`,
    `turn hashes compared ${rs.reduce((s, r) => s + r.hashes, 0)}, loads ${rs.reduce((s, r) => s + r.loads, 0)}, runs won ${rs.filter((r) => r.status === 'won').length} lost ${rs.filter((r) => r.status === 'lost').length}`,
    '', ...rs.filter((r) => r.error || r.firstDiff).map((r) => `- ${r.job.home} ${r.job.size} ${r.job.difficulty} seed ${r.job.seed} policy ${r.job.policy}: ${r.error ?? r.firstDiff}`),
  ];
  const out = arg('out', `${QA_OUT}determinism-${seed0}.md`);
  fs.mkdirSync((await import('node:path')).dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
