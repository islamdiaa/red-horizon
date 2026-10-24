// World Conquest strategic benchmarks (headless, parallel; WORKERS caps the threads, default 4, STRAT's cap is 6).
//   node --import tsx tools/world/strat-bench.ts rates [--n 100] [--sizes blitz,world] [--diffs recruit,...] [--pilots zone,greedy,cautious,dice] [--skill casual] [--out f.json]
//   node --import tsx tools/world/strat-bench.ts fair [--n 12] [--size blitz] [--diff normal] [--pilot zone] [--homes a,b]   homeland fairness
//   node --import tsx tools/world/strat-bench.ts powers [--n 100] [--size world] [--diff normal]               how rivals fare
// Win rates carry 95% Wilson intervals. Every game is one seed (seed = base + 7 k) on a homeland rotated through the atlas.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import { atlas, type NewWorldOptions } from '../../src/conquest/world/run';
import { rate, pct, type GameResult, type PilotId, type PlayOptions, type Skill } from './strat-lib';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const cmd = process.argv[2] ?? 'rates';
const WORKERS = Math.max(1, Math.min(6, +(process.env.WORKERS ?? 4)));

interface Job { opts: NewWorldOptions; play: PlayOptions }

export async function runJobs(jobs: Job[], workers = WORKERS): Promise<GameResult[]> {
  const out: GameResult[] = new Array(jobs.length);
  let next = 0, done = 0;
  const pool: Worker[] = [];
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    if (!jobs.length) { resolve(); return; }
    const feed = (w: Worker) => { if (next < jobs.length) { const k = next++; w.postMessage({ k, ...jobs[k] }); } };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const w = new Worker(new URL('./strat-boot.mjs', import.meta.url));
      pool.push(w);
      w.on('message', (m: { k: number; res: GameResult }) => {
        out[m.k] = m.res;
        done++;
        if (done % 200 === 0) process.stderr.write(`  ${done}/${jobs.length} (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
        if (done === jobs.length) resolve(); else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  for (const w of pool) void w.terminate();
  return out;
}

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quant = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

function jobsFor(n: number, size: 'world' | 'blitz', difficulty: NewWorldOptions['difficulty'], play: PlayOptions, base = 1000): Job[] {
  const homes = atlas().homelands;
  return Array.from({ length: n }, (_, k) => ({ opts: { seed: base + k * 7, home: homes[(k * 7) % homes.length].id, size, difficulty }, play }));
}

if (cmd === 'rates') {
  const n = +arg('n', '100');
  const sizes = arg('sizes', 'blitz,world').split(',') as ('world' | 'blitz')[];
  const diffs = arg('diffs', 'recruit,easy,normal,hard,brutal').split(',') as NewWorldOptions['difficulty'][];
  const pilots = arg('pilots', 'zone,greedy,cautious,dice').split(',') as PilotId[];
  const skill = arg('skill', 'casual') as Skill;
  const jobs: Job[] = [];
  const keys: string[] = [];
  const diceOnly = process.argv.includes('--dice');
  const brain = arg('brain', '') ? JSON.parse(arg('brain', '{}')) : undefined;
  for (const size of sizes) for (const d of diffs) for (const pilot of pilots) for (const j of jobsFor(n, size, d, { pilot, skill, diceOnly, brain })) { jobs.push(j); keys.push(`${size}|${d}|${pilot}`); }
  const res = await runJobs(jobs);
  const out = arg('out', '');
  if (out) fs.writeFileSync(out, JSON.stringify(res));
  const errors = res.filter((r) => r.error);
  console.log(`World Conquest pilots (${n} games per cell, ${diceOnly ? 'dice only' : `battle skill ${skill}`}${brain ? `, brain ${JSON.stringify(brain)}` : ''}; win rate with 95% Wilson interval)\n`);
  console.log(`| size | difficulty | ${pilots.join(' | ')} |`);
  console.log(`|---|---|${pilots.map(() => '---').join('|')}|`);
  for (const size of sizes) for (const d of diffs) {
    const cells = pilots.map((p) => { const rs = res.filter((_, i) => keys[i] === `${size}|${d}|${p}`); return rate(rs.filter((r) => r.status === 'won').length, rs.length); });
    console.log(`| ${size} | ${d} | ${cells.join(' | ')} |`);
  }
  console.log(`\nShape of the games (zone pilot): turns to win (p10/median/p90), armistice endings, rivals eliminated per game, peak rival share (median/p90), longest quiet stretch in rounds (median/max), RTS battles per game\n`);
  console.log('| size | difficulty | turns to win | armistice | rivals out / game | peak rival share | quiet rounds | battles |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const size of sizes) for (const d of diffs) {
    const rs = res.filter((_, i) => keys[i] === `${size}|${d}|zone`);
    if (!rs.length) continue;
    const wins = rs.filter((r) => r.status === 'won').map((r) => r.turns);
    const share = rs.map((r) => r.peakRivalShare), quiet = rs.map((r) => r.longestQuiet);
    console.log(`| ${size} | ${d} | ${quant(wins, 0.1)}/${median(wins)}/${quant(wins, 0.9)} | ${pct(rs.filter((r) => r.ending === 'armistice').length / rs.length)} | ${(rs.reduce((s, r) => s + r.eliminated.filter((e) => e.turn !== null).length, 0) / rs.length).toFixed(1)} | ${pct(median(share))}/${pct(quant(share, 0.9))} | ${median(quiet)}/${Math.max(...quiet)} | ${(rs.reduce((s, r) => s + r.battles, 0) / rs.length).toFixed(1)} |`);
  }
  if (errors.length) { console.log(`\n${errors.length} games threw:`); for (const e of errors.slice(0, 5)) console.log(e.seed, e.home, e.error!.split('\n').slice(0, 3).join(' | ')); }
} else if (cmd === 'fair') {
  const n = +arg('n', '12');
  const size = arg('size', 'blitz') as 'world' | 'blitz';
  const d = arg('diff', 'normal') as NewWorldOptions['difficulty'];
  const pilot = arg('pilot', 'zone') as PilotId;
  const only = arg('homes', '') ? arg('homes', '').split(',') : null;
  const homes = atlas().homelands.filter((h) => !only || only.includes(h.id));
  const jobs: Job[] = [];
  for (const h of homes) for (let k = 0; k < n; k++) jobs.push({ opts: { seed: 5000 + k * 13, home: h.id, size, difficulty: d }, play: { pilot } });
  const res = await runJobs(jobs);
  const out = arg('out', '');
  if (out) fs.writeFileSync(out, JSON.stringify(res));
  const rows = homes.map((h) => { const rs = res.filter((r) => r.home === h.id); const w = rs.filter((r) => r.status === 'won').length; return { id: h.id, w, n: rs.length, turns: median(rs.filter((r) => r.status === 'won').map((r) => r.turns)) }; })
    .sort((a, b) => a.w / a.n - b.w / b.n);
  const all = res.filter((r) => r.status === 'won').length;
  console.log(`Homeland fairness: ${size} ${d}, pilot ${pilot}, ${n} seeds per homeland; overall ${rate(all, res.length)}\n`);
  console.log('| homeland | wins | rate (95%) | median turns |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.w}/${r.n} | ${rate(r.w, r.n)} | ${Number.isNaN(r.turns) ? '-' : r.turns} |`);
  const rates = rows.map((r) => r.w / r.n);
  console.log(`\nspread: min ${pct(Math.min(...rates))}, median ${pct(median(rates))}, max ${pct(Math.max(...rates))}; homelands never won: ${rows.filter((r) => r.w === 0).map((r) => r.id).join(', ') || 'none'}; always won: ${rows.filter((r) => r.w === r.n).map((r) => r.id).join(', ') || 'none'}`);
} else if (cmd === 'powers') {
  const n = +arg('n', '100');
  const size = arg('size', 'world') as 'world' | 'blitz';
  const d = arg('diff', 'normal') as NewWorldOptions['difficulty'];
  const res = await runJobs(jobsFor(n, size, d, { pilot: arg('pilot', 'zone') as PilotId }));
  const per = new Map<string, { n: number; out: number; turns: number[]; byHuman: number }>();
  for (const r of res) for (const e of r.eliminated) {
    const c = per.get(e.personality) ?? { n: 0, out: 0, turns: [], byHuman: 0 };
    c.n++;
    if (e.turn !== null) { c.out++; c.turns.push(e.turn); if (e.by === 0) c.byHuman++; }
    per.set(e.personality, c);
  }
  console.log(`Rival powers: ${size} ${d}, ${n} games\n\n| personality | eliminated | median turn | by you |\n|---|---|---|---|`);
  for (const [k, c] of [...per.entries()].sort()) console.log(`| ${k} | ${rate(c.out, c.n)} | ${median(c.turns)} | ${pct(c.byHuman / Math.max(1, c.out))} |`);
  const share = res.map((r) => r.peakRivalShare);
  console.log(`\npeak share any rival reached: median ${pct(median(share))}, p90 ${pct(quant(share, 0.9))}, max ${pct(Math.max(...share))}; human wins ${rate(res.filter((r) => r.status === 'won').length, res.length)}`);
}
