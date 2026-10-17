/**
 * [DOCTRINE] Commander-rules balance: headless AI-vs-AI self-play of doctrines and commander powers.
 *
 *   node --import tsx tools/selfplay/doctrine.ts [--seeds 6] [--workers 8] [--size 80] [--diff hard] [--only mirror,cross,powers,comeback]
 *
 * Experiments (mirror skill: both AIs on the same difficulty and the balanced personality, start slots swapped):
 *  - mirror:   every doctrine of a faction against every other one of the same faction and "no doctrine";
 *  - cross:    every Soviet doctrine against every Allied doctrine, compared with the no-doctrine faction baseline;
 *  - powers:   an AI using commander powers against one that never does (same faction, no doctrines);
 *  - comeback: how often the side behind on material at 10 minutes still wins, Classic rules vs Commander rules.
 * Prints the tables (Markdown) and writes the raw results to /tmp/rh-engage/doctrine/balance.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DOCTRINES, doctrinesFor } from '../../src/sim/doctrine';
import type { Faction } from '../../src/data/rules';
import { runPool } from './pool';
import type { MatchResult, MatchSpec } from './lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const seeds = +opt('seeds', '6');
const size = +opt('size', '80');
const diff = opt('diff', 'hard') as MatchSpec['players'][number]['difficulty'];
const workers = +opt('workers', '8') || undefined;
const only = new Set(opt('only', 'mirror,cross,powers,comeback').split(','));
const maxMinutes = +opt('max', '60');
const factions = opt('factions', 'soviet,allies').split(',') as Faction[];

type Tag = { exp: string; a: string; b: string };
const specs: MatchSpec[] = [];
const tags: Tag[] = [];
let id = 0;
const add = (exp: string, a: string, b: string, players: MatchSpec['players'], extra: Partial<MatchSpec>, seed: number) => {
  specs.push({ id: id++, seed, map: 'land', size, players, maxMinutes, ...extra });
  tags.push({ exp, a, b });
};
const P = (faction: Faction) => ({ faction, difficulty: diff, personality: 'balanced' });
const SEED0 = 1000;

// ---- mirror: same faction, doctrine vs doctrine (and vs none), both slot orders
if (only.has('mirror')) {
  for (const f of factions) {
    const ds = [...doctrinesFor(f).map((d) => d.id), 'none'];
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) for (let s = 0; s < seeds; s++) {
      const seed = SEED0 + s * 7 + i * 31 + j * 131;
      add('mirror', ds[i], ds[j], [P(f), P(f)], { commander: { doctrines: [ds[i], ds[j]] } }, seed);
      add('mirror', ds[j], ds[i], [P(f), P(f)], { commander: { doctrines: [ds[j], ds[i]] } }, seed);
    }
  }
}
// ---- cross: Soviet doctrine vs Allied doctrine (and the none / none baseline), both slot orders
if (only.has('cross')) {
  const sov = [...doctrinesFor('soviet').map((d) => d.id), 'none'], all = [...doctrinesFor('allies').map((d) => d.id), 'none'];
  for (const a of sov) for (const b of all) for (let s = 0; s < Math.max(2, Math.ceil(seeds / 2)); s++) {
    const seed = SEED0 + 5000 + s * 11 + sov.indexOf(a) * 37 + all.indexOf(b) * 101;
    add('cross', a, b, [P('soviet'), P('allies')], { commander: { doctrines: [a, b] } }, seed);
    add('cross', b, a, [P('allies'), P('soviet')], { commander: { doctrines: [b, a] } }, seed);
  }
}
// ---- powers vs no powers (no doctrines), mirror factions, both slot orders
if (only.has('powers')) {
  for (const f of ['soviet', 'allies'] as Faction[]) for (let s = 0; s < seeds * 2; s++) {
    const seed = SEED0 + 9000 + s * 13 + (f === 'allies' ? 1 : 0);
    add('powers', 'powers', 'none', [P(f), P(f)], { commander: { doctrines: ['none', 'none'], noPowers: [1] } }, seed);
    add('powers', 'none', 'powers', [P(f), P(f)], { commander: { doctrines: ['none', 'none'], noPowers: [0] } }, seed);
  }
}
// ---- comeback: the same matches under Classic and Commander rules (AI doctrines)
if (only.has('comeback')) {
  for (let s = 0; s < seeds * 7; s++) {
    const seed = SEED0 + 13000 + s * 17;
    const fs: Faction[] = s % 2 ? ['soviet', 'allies'] : ['allies', 'soviet'];
    const f2: Faction[] = s % 3 === 0 ? [fs[0], fs[0]] : fs;
    add('comeback', 'classic', '', [P(f2[0]), P(f2[1])], {}, seed);
    add('comeback', 'commander', '', [P(f2[0]), P(f2[1])], { commander: {} }, seed);
  }
}

console.log(`${specs.length} matches (${diff}, ${size}x${size} land, ${seeds} seeds)…`);
const t0 = performance.now();
let last = 0;
const res: MatchResult[] = await runPool(specs, {
  workers,
  progress: (done, total) => {
    const now = performance.now();
    if (now - last > 15000 || done === total) { last = now; console.error(`  ${done}/${total} (${((now - t0) / 1000).toFixed(0)} s)`); }
  },
});
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
mkdirSync('/tmp/rh-engage/doctrine', { recursive: true });
writeFileSync('/tmp/rh-engage/doctrine/balance.json', JSON.stringify(res.map((r, i) => ({ ...tags[i], seed: r.seed, winner: r.winnerTeam, leader: r.leader, minutes: Math.round(r.minutes * 10) / 10, timedOut: r.timedOut, samples: r.samples, players: r.players.map((p) => ({ faction: p.faction, doctrine: p.doctrine, won: p.won, earned: p.cmdEarned, uses: p.cmdUses, score: p.score })) }))));

const pct = (w: number, n: number) => (n ? `${((100 * w) / n).toFixed(0)}%` : '-');
/**
 * Result for slot 0 / 1: a win 1, a loss 0; a game still running at the time limit goes to the side ahead on material
 * by 10% or more, else it is a draw (0.5 each).
 */
const ahead = (r: MatchResult, i: number) => r.players[i].score >= 1.1 * r.players[1 - i].score;
const score0 = (r: MatchResult) => (r.timedOut ? (ahead(r, 0) ? 1 : ahead(r, 1) ? 0 : 0.5) : r.winnerTeam === 0 ? 1 : 0);
const score1 = (r: MatchResult) => 1 - score0(r);
const name = (d: string) => (DOCTRINES[d]?.name ?? (d === 'none' ? 'No doctrine' : d));

if (only.has('mirror')) {
  console.log('## Same-faction matchups (row doctrine score against column: win 1, loss 0; at the time limit 10%+ ahead on material wins, else a draw; hard vs hard, balanced personalities, both slot orders)\n');
  for (const f of factions) {
    const ds = [...doctrinesFor(f).map((d) => d.id), 'none'];
    const W: Record<string, Record<string, [number, number]>> = {};
    for (const a of ds) { W[a] = {}; for (const b of ds) W[a][b] = [0, 0]; }
    res.forEach((r, i) => {
      const t = tags[i];
      if (t.exp !== 'mirror' || r.players[0].faction !== f) return;
      W[t.a][t.b][0] += score0(r); W[t.a][t.b][1]++;
      W[t.b][t.a][0] += score1(r); W[t.b][t.a][1]++;
    });
    let to = 0, nn = 0, mm = 0;
    res.forEach((r, i) => { if (tags[i].exp === 'mirror' && r.players[0].faction === f) { nn++; mm += r.minutes; if (r.timedOut) to++; } });
    console.log(`### ${f === 'soviet' ? 'Soviet' : 'Allies'} (${nn} games, ${to} reached the ${maxMinutes}-min limit and were scored on material, avg ${(mm / Math.max(1, nn)).toFixed(1)} min)\n`);
    console.log(`| doctrine | ${ds.map(name).join(' | ')} | overall |`);
    console.log(`|---|${ds.map(() => '---').join('|')}|---|`);
    for (const a of ds) {
      let w = 0, n = 0;
      const cells = ds.map((b) => {
        if (a === b) return '—';
        const [x, m] = W[a][b];
        w += x; n += m;
        return pct(x, m);
      });
      console.log(`| ${name(a)} | ${cells.join(' | ')} | **${pct(w, n)}** (${n}) |`);
    }
    console.log('');
  }
}

if (only.has('cross')) {
  console.log('## Cross-faction (Soviet doctrine vs Allied doctrine): win rate of the Soviet side\n');
  const sov = [...doctrinesFor('soviet').map((d) => d.id), 'none'], all = [...doctrinesFor('allies').map((d) => d.id), 'none'];
  const W: Record<string, Record<string, [number, number]>> = {};
  for (const a of sov) { W[a] = {}; for (const b of all) W[a][b] = [0, 0]; }
  res.forEach((r, i) => {
    const t = tags[i];
    if (t.exp !== 'cross') return;
    const sovSlot = r.players[0].faction === 'soviet' ? 0 : 1;
    const a = sovSlot === 0 ? t.a : t.b, b = sovSlot === 0 ? t.b : t.a;
    W[a][b][0] += sovSlot === 0 ? score0(r) : score1(r); W[a][b][1]++;
  });
  console.log(`| Soviet \\ Allies | ${all.map(name).join(' | ')} | overall |`);
  console.log(`|---|${all.map(() => '---').join('|')}|---|`);
  for (const a of sov) {
    let w = 0, n = 0;
    const cells = all.map((b) => { const [x, m] = W[a][b]; w += x; n += m; return pct(x, m); });
    console.log(`| ${name(a)} | ${cells.join(' | ')} | ${pct(w, n)} |`);
  }
  const col = all.map((b) => { let w = 0, n = 0; for (const a of sov) { w += W[a][b][1] - W[a][b][0]; n += W[a][b][1]; } return pct(w, n); });
  console.log(`| *Allied win rate* | ${col.join(' | ')} | |\n`);
}

if (only.has('powers')) {
  let w = 0, n = 0, earnedP = 0, earnedN = 0, mins = 0;
  const uses: Record<string, number> = {};
  res.forEach((r, i) => {
    const t = tags[i];
    if (t.exp !== 'powers') return;
    const ps = t.a === 'powers' ? 0 : 1;
    w += ps === 0 ? score0(r) : score1(r); n++;
    earnedP += r.players[ps].cmdEarned ?? 0; earnedN += r.players[1 - ps].cmdEarned ?? 0; mins += r.minutes;
    for (const [k, v] of Object.entries(r.players[ps].cmdUses ?? {})) uses[k] = (uses[k] ?? 0) + v;
  });
  console.log('## AI with commander powers vs AI without (no doctrines, same faction)\n');
  console.log(`| matches | powers side wins | avg length | CP earned (powers / no powers) |`);
  console.log(`|---|---|---|---|`);
  console.log(`| ${n} | **${pct(w, n)}** | ${(mins / Math.max(1, n)).toFixed(1)} min | ${(earnedP / Math.max(1, n)).toFixed(1)} / ${(earnedN / Math.max(1, n)).toFixed(1)} |\n`);
  console.log(`Powers used per match: ${Object.entries(uses).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / Math.max(1, n)).toFixed(1)}`).join(', ')}\n`);
}

if (only.has('comeback')) {
  console.log(`## Comebacks and snowballing: the side behind on material (by 15%+) at 10 / 15 min, and how it ends (${maxMinutes}-min cap)\n`);
  console.log('| rules | games | decided | avg length | behind at 10 min | comebacks from 10 min | behind at 15 min | comebacks from 15 min |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const rules of ['classic', 'commander']) {
    let decided = 0, mins = 0, n = 0;
    const st = { 10: [0, 0], 15: [0, 0] } as Record<number, [number, number]>;
    res.forEach((r, i) => {
      if (tags[i].exp !== 'comeback' || tags[i].a !== rules) return;
      n++; mins += r.minutes;
      if (!r.timedOut) decided++;
      for (const at of [10, 15]) {
        const s = r.samples?.find((x) => x.min === at);
        if (!s) continue; // (over before then)
        const [a, b] = s.score;
        if (Math.min(a, b) > 0.85 * Math.max(a, b)) continue;
        const lag = a < b ? 0 : 1;
        st[at][0]++;
        // a comeback: the side behind wins, or is ahead by 10%+ when time runs out
        if ((lag === 0 ? score0(r) : score1(r)) === 1) st[at][1]++;
      }
    });
    console.log(`| ${rules} | ${n} | ${decided} | ${(mins / Math.max(1, n)).toFixed(1)} min | ${st[10][0]} | **${pct(st[10][1], st[10][0])}** (${st[10][1]}) | ${st[15][0]} | **${pct(st[15][1], st[15][0])}** (${st[15][1]}) |`);
  }
  console.log('');
}
