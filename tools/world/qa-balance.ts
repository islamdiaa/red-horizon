// World Conquest QA: the balance tables (round 6 contract, "Strategy that holds up"), from STRAT's pilot policies
// (tools/world/strat-lib.ts playGame: greedy, zone-focused, cautious, dice-only; RTS battles drawn from the measured
// battle-pilot curves) played on the real geography:
//   1. win rate per size x difficulty x pilot, 95% Wilson intervals, and turns to win;
//   2. zone-focused against greedy on the same seeds (paired: who wins where the other loses);
//   3. homeland fairness: every homeland, the zone pilot, Blitz at Normal: win-rate spread, unwinnable / trivial ones;
//   4. the rival powers: how often each personality is eliminated, by whom, when; how far the strongest rival grows
//      (snowball) and the longest stall.
//
//   node --import tsx tools/world/qa-balance.ts [--n 60] [--nworld 24] [--fair 12] [--skill auto] [--out dir]   (WORKERS=n, default 6)
import { QA_OUT } from './qa-pool'; // (results default to screenshots/world-qa/ in the repo: git-ignored)
import type { GameResult, PilotId, Skill } from './strat-lib';

export interface BalJob { seed: number; home: string; size: 'blitz' | 'world'; difficulty: string; pilot: PilotId; skill: Skill; tag: string }

export async function balanceOne(j: BalJob): Promise<GameResult & { tag: string }> {
  await import('../../src/conquest/world/index'); // (the barrel: the real geography)
  const { playGame } = await import('./strat-lib');
  const r = playGame({ seed: j.seed, home: j.home, size: j.size, difficulty: j.difficulty as never }, { pilot: j.pilot, skill: j.skill });
  return { ...r, tag: j.tag };
}

const wilson = (k: number, n: number): [number, number] => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const rate = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${Math.round(100 * k / n)}% (${Math.round(100 * a)}-${Math.round(100 * b)}) n${n}` : '-'; };
const q = (l: number[], p: number) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

if (process.argv[1]?.endsWith('qa-balance.ts')) {
  const fs = await import('node:fs');
  const { runPool } = await import('./qa-pool');
  const W = await import('../../src/conquest/world/index');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const n = +arg('n', '60'), nWorld = +arg('nworld', '24'), nFair = +arg('fair', '12');
  const skillArg = arg('skill', 'by-level'); // by-level: newcomer battles at Recruit/Easy, casual above (who picks which level)
  const out = arg('out', `${QA_OUT}balance`);
  fs.mkdirSync(out, { recursive: true });
  const homes = W.atlas().homelands.map((h) => h.id);
  const DIFFS = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
  const PILOTS: PilotId[] = ['zone', 'greedy', 'cautious', 'dice'];
  const skillFor = (d: string): Skill => (skillArg !== 'by-level' ? skillArg as Skill : d === 'recruit' || d === 'easy' ? 'newcomer' : 'casual');
  const jobs: BalJob[] = [];
  for (const size of ['blitz', 'world'] as const) for (const difficulty of DIFFS) for (const pilot of PILOTS) {
    const N = size === 'blitz' ? n : nWorld;
    for (let k = 0; k < N; k++) jobs.push({ seed: 1000 + 7 * k, home: homes[(k * 7 + 3) % homes.length], size, difficulty, pilot, skill: skillFor(difficulty), tag: 'rates' });
  }
  const fairSets = arg('fairsets', 'blitz:normal,world:normal,blitz:hard').split(',').map((x) => x.split(':') as ['blitz' | 'world', string]);
  for (const [size, difficulty] of fairSets) for (const home of homes) for (let k = 0; k < nFair; k++) jobs.push({ seed: 5000 + 11 * k, home, size, difficulty, pilot: 'zone', skill: skillFor(difficulty), tag: `fair:${size}:${difficulty}` });
  console.log(`${jobs.length} games (rates ${jobs.filter((j) => j.tag === 'rates').length}, fairness ${jobs.filter((j) => j.tag.startsWith('fair')).length}), skill ${skillArg}`);
  const t0 = Date.now();
  const outs = await runPool<BalJob, GameResult & { tag: string }>('./qa-balance.ts', 'balanceOne', jobs, { progress: (d, t, o) => { if (!o.ok) console.log(`ERR ${o.error.split('\n')[0]}`); if (d % 200 === 0 || d === t) console.log(`${d}/${t} ${Math.round((Date.now() - t0) / 1000)} s`); } });
  const rs = outs.map((o) => (o.ok ? o.value : null)).filter(Boolean) as (GameResult & { tag: string })[];
  fs.writeFileSync(`${out}/balance.json`, JSON.stringify(rs));
  const L: string[] = [`# World Conquest balance (STRAT pilots, real geography): ${rs.length} games, ${Math.round((Date.now() - t0) / 60000)} min; battle skill ${skillArg}`, ''];
  const errs = rs.filter((r) => r.error);
  if (errs.length) L.push(`errors: ${errs.length} (first: ${errs[0].error?.split('\n')[0]})`, '');
  const R = rs.filter((r) => r.tag === 'rates' && !r.error);
  // 1. win rates and turns to win
  for (const size of ['blitz', 'world']) {
    L.push(`## ${size}: win rate (95% Wilson) and turns to win (median, p25-p75)`, '', `| difficulty | ${PILOTS.join(' | ')} | turns to win (zone) | still active |`, `|---|${PILOTS.map(() => '---').join('|')}|---|---|`);
    for (const d of DIFFS) {
      const cells = PILOTS.map((p) => { const g = R.filter((r) => r.size === size && r.difficulty === d && r.pilot === p); return rate(g.filter((r) => r.status === 'won').length, g.length); });
      const won = R.filter((r) => r.size === size && r.difficulty === d && r.pilot === 'zone' && r.status === 'won').map((r) => r.turns);
      const act = R.filter((r) => r.size === size && r.difficulty === d && r.status === 'active').length;
      L.push(`| ${d} | ${cells.join(' | ')} | ${won.length ? `${q(won, 0.5)} (${q(won, 0.25)}-${q(won, 0.75)})` : '-'} | ${act} |`);
    }
    L.push('');
  }
  // 2. zone vs greedy, paired by seed / homeland / size / difficulty
  L.push('## Zone-focused against greedy (same seeds)', '', '| size | difficulty | zone wins | greedy wins | only zone won | only greedy won |', '|---|---|---|---|---|---|');
  let oz = 0, og = 0;
  for (const size of ['blitz', 'world']) for (const d of DIFFS) {
    const key = (r: GameResult) => `${r.seed}|${r.home}`;
    const z = new Map(R.filter((r) => r.size === size && r.difficulty === d && r.pilot === 'zone').map((r) => [key(r), r]));
    const g = R.filter((r) => r.size === size && r.difficulty === d && r.pilot === 'greedy');
    let onlyZ = 0, onlyG = 0;
    for (const r of g) { const zr = z.get(key(r)); if (!zr) continue; if (zr.status === 'won' && r.status !== 'won') onlyZ++; if (r.status === 'won' && zr.status !== 'won') onlyG++; }
    oz += onlyZ; og += onlyG;
    L.push(`| ${size} | ${d} | ${[...z.values()].filter((r) => r.status === 'won').length}/${z.size} | ${g.filter((r) => r.status === 'won').length}/${g.length} | ${onlyZ} | ${onlyG} |`);
  }
  // sign test on the discordant pairs
  const nd = oz + og, zsc = nd ? (oz - nd / 2) / Math.sqrt(nd / 4) : 0;
  L.push('', `discordant pairs: zone only ${oz}, greedy only ${og} (sign test z = ${zsc.toFixed(2)}${Math.abs(zsc) > 1.96 ? ', significant at 5%' : ', not significant'})`, '');
  // 3. homeland fairness, per set (size x difficulty)
  for (const [size, difficulty] of fairSets) {
    const F = rs.filter((r) => r.tag === `fair:${size}:${difficulty}` && !r.error);
    if (!F.length) continue;
    const rows = homes.map((h) => { const g = F.filter((r) => r.home === h); const w = g.filter((r) => r.status === 'won').length; const wiped5 = g.filter((r) => r.status === 'lost' && r.turns <= 5).length; return { h, w, n: g.length, p: g.length ? w / g.length : 0, wiped5 }; }).sort((a, b) => a.p - b.p);
    const ps = rows.map((r) => r.p);
    const all = F.filter((r) => r.status === 'won').length, P = all / Math.max(1, F.length);
    L.push(`## Homeland fairness: zone pilot, ${size}, ${difficulty}, ${nFair} seeds each`, '', `overall ${rate(all, F.length)}; spread: min ${Math.round(100 * Math.min(...ps))}%, p10 ${Math.round(100 * (q(ps, 0.1) ?? 0))}%, median ${Math.round(100 * (q(ps, 0.5) ?? 0))}%, p90 ${Math.round(100 * (q(ps, 0.9) ?? 0))}%, max ${Math.round(100 * Math.max(...ps))}%`);
    L.push(`never won: ${rows.filter((r) => r.w === 0).map((r) => r.h).join(', ') || 'none'}; always won: ${rows.filter((r) => r.w === r.n).map((r) => r.h).join(', ') || 'none'}; 95% interval below the overall rate: ${rows.filter((r) => wilson(r.w, r.n)[1] < P).map((r) => `${r.h} ${r.w}/${r.n}`).join(', ') || 'none'}; above: ${rows.filter((r) => wilson(r.w, r.n)[0] > P).map((r) => `${r.h} ${r.w}/${r.n}`).join(', ') || 'none'}`);
    L.push(`wiped out by turn 5: ${F.filter((r) => r.status === 'lost' && r.turns <= 5).length}/${F.length}; worst homelands: ${rows.filter((r) => r.wiped5).sort((a, b) => b.wiped5 - a.wiped5).slice(0, 6).map((r) => `${r.h} ${r.wiped5}`).join(', ') || 'none'}`, '');
    L.push(rows.map((r) => `${r.h} ${r.w}/${r.n}`).join(' · '), '');
  }
  // 3b. early wipe-outs in the rates games
  L.push('## Wiped out by turn 5 (rates games)', '', `| size | difficulty | ${PILOTS.join(' | ')} |`, `|---|---|${PILOTS.map(() => '---').join('|')}|`);
  for (const size of ['blitz', 'world']) for (const d of DIFFS) L.push(`| ${size} | ${d} | ${PILOTS.map((p) => { const g = R.filter((r) => r.size === size && r.difficulty === d && r.pilot === p); return rate(g.filter((r) => r.status === 'lost' && r.turns <= 5).length, g.length); }).join(' | ')} |`);
  L.push('');
  // 4. rival powers
  L.push('## Rival powers (every rates game)', '', '| size | personality | games | eliminated | by you | by a rival | median turn | strongest rival share p90 | longest stall p90 (rounds) |', '|---|---|---|---|---|---|---|---|---|');
  for (const size of ['blitz', 'world']) {
    const G = R.filter((r) => r.size === size);
    const pers = [...new Set(G.flatMap((r) => r.eliminated.map((e) => e.personality)))].sort();
    for (const p of pers) {
      const es = G.flatMap((r) => r.eliminated.filter((e) => e.personality === p));
      const el = es.filter((e) => e.turn !== null);
      L.push(`| ${size} | ${p} | ${es.length} | ${rate(el.length, es.length)} | ${el.filter((e) => e.by === 0).length} | ${el.filter((e) => e.by !== 0).length} | ${q(el.map((e) => e.turn!), 0.5) ?? '-'} | ${Math.round(100 * (q(G.map((r) => r.peakRivalShare), 0.9) ?? 0))}% | ${q(G.map((r) => r.longestQuiet), 0.9)} |`);
    }
  }
  fs.writeFileSync(`${out}/balance.md`, L.join('\n') + '\n');
  console.log(L.join('\n'));
}
