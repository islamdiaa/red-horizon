/**
 * Difficulty against human stand-ins: the AI's win share against a scripted novice, a scripted casual player and an
 * experienced player (the frozen version-2 Normal AI with a human's economy), per difficulty, ruleset and map size.
 * See tools/selfplay/standin.ts for what each stand-in does.
 *
 *   node --import tsx tools/selfplay/standins.ts [--games 12] [--diff recruit,easy,normal,hard,brutal]
 *        [--vs novice,casual,experienced] [--rules classic,commander] [--size 64,96] [--minutes 45]
 *        [--personality balanced|all] [--dynamic 1] [--events 0] [--econ 0] [--seed 1] [--json out.json]
 *
 * --games is per cell (difficulty x stand-in x ruleset x size); factions and start positions alternate. A match still
 * running at the time limit goes to the side ahead on material (the self-play convention). The report gives every
 * cell and the pooled rows with 95% Wilson intervals. --personality all rotates the AI through every personality
 * (one per game) instead of the default skirmish opponent (balanced). Workers: WORKERS env (default 8).
 */
import { writeFileSync } from 'node:fs';
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { PERSONALITIES } from '../../src/sim/ai-personality';
import { runPool } from './pool';
import type { MatchResult, MatchSpec, PlayerSpec } from './lib';
import type { StandInLevel } from './standin';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const games = +opt('games', '12');
const diffs = opt('diff', 'recruit,easy,normal,hard,brutal').split(',') as AIDifficulty[];
const vs = opt('vs', 'novice,casual,experienced').split(',') as StandInLevel[];
const rulesSets = opt('rules', 'classic,commander').split(',');
const sizes = opt('size', '64,96').split(',').map(Number);
const minutes = +opt('minutes', '45');
const persArg = opt('personality', 'balanced');
const dynamic = opt('dynamic', '0') === '1';
// (ablations) --events 0: no battlefield events; --econ 0: Commander rules without the Commander economy
const events = opt('events', '') === '0' ? false : undefined;
const econ = opt('econ', '') === '0' ? false : undefined;
const seed0 = +opt('seed', '1');
const jsonOut = opt('json', '');
const PIDS = Object.keys(PERSONALITIES);

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
const fmt = (k: number, n: number) => {
  const [lo, hi] = wilson(k, n);
  return `${n ? Math.round((100 * k) / n) : 0}% [${Math.round(lo * 100)}–${Math.round(hi * 100)}] (${k}/${n})`;
};

interface Tag { rules: string; size: number; diff: AIDifficulty; vs: StandInLevel; pers: string }
const specs: MatchSpec[] = [];
const tags: Tag[] = [];
let id = 0;
for (const rules of rulesSets) for (const size of sizes) for (const diff of diffs) for (const lv of vs) for (let g = 0; g < games; g++) {
  const f: Faction = g % 2 ? 'soviet' : 'allies';
  const pers = persArg === 'all' ? PIDS[(g + diffs.indexOf(diff)) % PIDS.length] : persArg;
  const ai: PlayerSpec = { faction: f, difficulty: diff, personality: pers, label: 'ai' };
  const human: PlayerSpec = { faction: f === 'allies' ? 'soviet' : 'allies', difficulty: 'normal', standin: lv, label: lv };
  const seed = seed0 + g * 7919 + size * 13 + (rules === 'commander' ? 50021 : 0) + vs.indexOf(lv) * 101;
  specs.push({ id: id++, seed, map: 'land', size, players: g % 4 < 2 ? [ai, human] : [human, ai], maxMinutes: minutes, commander: rules === 'commander' ? { econ } : undefined, dynamic, events });
  tags.push({ rules, size, diff, vs: lv, pers });
}

const t0 = Date.now();
console.log(`running ${specs.length} matches (${games} per cell)…`);
let last = 0;
const res: MatchResult[] = await runPool(specs, {
  workers: +(process.env.WORKERS ?? 8),
  progress: (done, total) => { if (Date.now() - last > 30000 || done === total) { last = Date.now(); console.log(`  ${done}/${total} (${Math.round((Date.now() - t0) / 1000)} s)`); } },
});

const aiWon = (r: MatchResult) => {
  const i = r.players.findIndex((p) => p.label === 'ai');
  return (r.winnerTeam >= 0 ? r.winnerTeam : r.leader) === i;
};
function table(key: (t: Tag) => string, title: string) {
  const cells = new Map<string, { k: number; n: number; to: number; min: number[] }>();
  res.forEach((r, i) => {
    const c = cells.get(key(tags[i])) ?? { k: 0, n: 0, to: 0, min: [] };
    c.n++;
    if (aiWon(r)) c.k++;
    if (r.timedOut) c.to++;
    c.min.push(r.minutes);
    cells.set(key(tags[i]), c);
  });
  console.log(`\n## ${title}`);
  console.log('| cell | AI wins [95% CI] | timeouts | mean length |');
  console.log('|---|---|---|---|');
  for (const [k, c] of cells) console.log(`| ${k} | ${fmt(c.k, c.n)} | ${c.to} | ${(c.min.reduce((a, b) => a + b, 0) / c.n).toFixed(1)} min |`);
}
table((t) => `${t.rules} ${t.size} ${t.diff} vs ${t.vs}`, 'Every cell');
table((t) => `${t.rules} ${t.diff} vs ${t.vs}`, 'Per ruleset (sizes pooled)');
table((t) => `${t.diff} vs ${t.vs}`, 'All rulesets and sizes pooled');
if (persArg === 'all') table((t) => `${t.diff} ${t.pers}`, 'Per personality (all stand-ins pooled)');

// economy at a glance: harvested per minute, AI vs stand-in, per difficulty and ruleset
console.log('\n## Harvest per minute of play (AI / stand-in, means)');
const eco = new Map<string, [number, number, number]>();
res.forEach((r, i) => {
  const k = `${tags[i].rules} ${tags[i].diff} vs ${tags[i].vs}`;
  const a = r.players.find((p) => p.label === 'ai')!, h = r.players.find((p) => p.label !== 'ai')!;
  const e = eco.get(k) ?? [0, 0, 0];
  e[0] += a.harvested / Math.max(1, r.minutes); e[1] += h.harvested / Math.max(1, r.minutes); e[2]++;
  eco.set(k, e);
});
for (const [k, [a, h, n]] of eco) console.log(`  ${k.padEnd(34)} $${Math.round(a / n)}/min vs $${Math.round(h / n)}/min`);
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res.map((r, i) => ({ ...r, tag: tags[i] }))));
